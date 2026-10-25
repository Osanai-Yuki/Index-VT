"""Probe local Index models; this does not run the Wenyi pipeline.

Run from the repository root:
    python scripts/wenyi-model-probe.py --output docs/research/wenyi-model-probe-2026-10-25.json

Uses only Python's standard library and existing GGUF/llama-server files.
Starts one private server at a time, with the production GPU/context defaults.
Synthetic public samples are included below; no application database is read.
"""

import argparse
import json
import os
import socket
import statistics
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
SOURCE = """雨停的时候，林舟已经走到了旧车站。站台上的钟慢了十分钟，候车室里却没有一个旅客。

他从口袋里取出一张折了四次的地图，仔细寻找河对岸的小镇。地图上没有桥，只有一条用蓝色墨水画出的虚线。管理员告诉他，冬天来临之前，最后一班渡船每天傍晚六点离岸。

“如果今天赶不上，就在这里住一晚。”管理员一边说，一边把窗户推开。凉风带进了潮湿的泥土气味。林舟想起妹妹写在信末的那句话：不用着急，我们等的是你，不是那只箱子。

他把地图收好，将沉重的木箱暂时寄存在行李房。收据上的号码是二十七，与信封背面的数字相同。这个巧合让他停了片刻，但他最终没有回头询问，只沿着站前的小路向河边走去。

太阳落下之前，他终于看见了渡船。船夫没有催促，只抬手指了指船头空着的位置。远处的小镇亮起第一盏灯，河面上的风也渐渐平静下来。"""
SEGMENTS = ["雨停的时候，林舟已经走到了旧车站。", "站台上的钟慢了十分钟。", "管理员说：最后一班渡船傍晚六点离岸。"]


def request(base, route, body=None, timeout=120):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(base + route, data=data, headers={"Content-Type": "application/json"})
    with HTTP.open(req, timeout=timeout) as response:
        return json.load(response)


def cases():
    for repeat in range(3):
        yield {
            "id": f"plain_translation_{repeat + 1}",
            "messages": [{"role": "user", "content": "请将以下中文文本翻译为英语，直接输出翻译结果，不要进行任何解释。\n\n" + SOURCE}],
            "max_tokens": 1536,
        }
    yield {
        "id": "representative_segment_json",
        "messages": [
            {"role": "system", "content": "You translate Chinese fiction into English. Return a JSON object with exactly one key, translations, whose value is an array of translated strings. Preserve the number and order of segments. No explanation."},
            {"role": "user", "content": "Translate these 3 segments. Return json:\n" + json.dumps(SEGMENTS, ensure_ascii=False)},
        ],
        "max_tokens": 512,
        "response_format": {"type": "json_object"},
    }
    yield {
        "id": "representative_style_analysis_json",
        "messages": [{"role": "user", "content": 'Analyze the following Chinese fiction; do not translate the story. Return a json object with keys "style_guide" (an English description of the writing style), "characters" (an array of character names), and "glossary" (an array of objects with source and target keys for proper names).\n\n' + SOURCE}],
        "max_tokens": 512,
        "response_format": {"type": "json_object"},
    }


def inspect(case, response):
    choice = response["choices"][0]
    text = choice["message"].get("content") or ""
    result = {"text": text, "finish_reason": choice.get("finish_reason"), "usage": response.get("usage"), "timings": response.get("timings")}
    if case["id"].endswith("json"):
        try:
            parsed = json.loads(text)
            result["valid_json"] = True
            if case["id"] == "representative_segment_json":
                values = parsed.get("translations") if isinstance(parsed, dict) else None
                result["expected_schema"] = isinstance(values, list) and len(values) == len(SEGMENTS) and all(isinstance(v, str) and v.strip() for v in values)
            else:
                result["expected_schema"] = isinstance(parsed, dict) and isinstance(parsed.get("style_guide"), str) and isinstance(parsed.get("characters"), list) and isinstance(parsed.get("glossary"), list)
        except (ValueError, TypeError):
            result["valid_json"] = False
            result["expected_schema"] = False
    return result


def probe(model_name, scratch):
    with socket.socket() as port_socket:
        port_socket.bind(("127.0.0.1", 0))
        port = port_socket.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    args = [str(ROOT / "thirdparty/llama-server/llama-server.exe"), "-m", str(ROOT / "models" / model_name), "--host", "127.0.0.1", "--port", str(port), "-c", "8192", "-fa", "on", "--no-webui", "--parallel", "1", "-ngl", "99", "--alias", "indexvt-probe"]
    started = time.perf_counter()
    log_path = scratch / (model_name + ".server.log")
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(args, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"llama-server exited with {process.returncode}; inspect {log_path}")
                try:
                    request(base, "/health", timeout=1)
                    break
                except (urllib.error.URLError, TimeoutError, OSError) as error:
                    reason = error.reason if isinstance(error, urllib.error.URLError) else error
                    if isinstance(reason, PermissionError) or getattr(reason, "winerror", None) == 10013:
                        raise PermissionError("Local HTTP sockets are blocked by the execution sandbox") from error
                    if time.perf_counter() - started > 90:
                        raise TimeoutError(f"Server did not become healthy; inspect {log_path}")
                    time.sleep(0.1)
            result = {"model": model_name, "startup_seconds": time.perf_counter() - started, "cases": []}
            # Exclude a small warm-up from measured cases.
            request(base, "/v1/chat/completions", {"model": "indexvt-probe", "messages": [{"role": "user", "content": "请将以下中文翻译为英语：你好。"}], "temperature": 0, "max_tokens": 32, "chat_template_kwargs": {"enable_thinking": False}})
            for case in cases():
                body = {"model": "indexvt-probe", "temperature": 0, "chat_template_kwargs": {"enable_thinking": False}, "stream": False, **{k: v for k, v in case.items() if k != "id"}}
                begin = time.perf_counter()
                try:
                    response = request(base, "/v1/chat/completions", body)
                    measured = {"id": case["id"], "wall_seconds": time.perf_counter() - begin, **inspect(case, response)}
                    tokens = (measured.get("usage") or {}).get("completion_tokens")
                    measured["end_to_end_output_tokens_per_second"] = tokens / measured["wall_seconds"] if tokens else None
                except (urllib.error.URLError, TimeoutError, OSError, KeyError, ValueError) as error:
                    measured = {"id": case["id"], "wall_seconds": time.perf_counter() - begin, "error": str(error)}
                result["cases"].append(measured)
                print(json.dumps({"model": model_name, **{k: v for k, v in measured.items() if k not in ("text", "timings")}}, ensure_ascii=False), flush=True)
            rates = [c["timings"]["predicted_per_second"] for c in result["cases"] if c["id"].startswith("plain_translation_") and (c.get("timings") or {}).get("predicted_per_second") and c.get("finish_reason") == "stop"]
            result["plain_decode_median_tokens_per_second"] = statistics.median(rates) if rates else None
            return result
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT):
        parser.error("Output must be inside the repository")
    scratch = ROOT / ".tmp-wenyi-probe"
    scratch.mkdir(exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "Synthetic compatibility probes, not an end-to-end Wenyi run or quality benchmark",
        "engine": subprocess.check_output([str(ROOT / "thirdparty/llama-server/llama-server.exe"), "--version"], text=True, stderr=subprocess.STDOUT).strip(),
        "gpu": subprocess.check_output(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"], text=True).strip(),
        "settings": {"context_tokens": 8192, "gpu_layers": 99, "flash_attention": "on", "parallel_slots": 1, "temperature": 0, "thinking": False},
        "plain_source": SOURCE,
        "segment_sources": SEGMENTS,
        "models": [],
    }
    for model in ("Index-Translate-2B.Q4_K_M.gguf", "Index-Nailong-2B.Q4_K_M.gguf"):
        report["models"].append(probe(model, scratch))
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {output}", flush=True)


if __name__ == "__main__":
    main()
