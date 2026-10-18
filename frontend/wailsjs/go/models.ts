export namespace config {
	
	export class Appearance {
	    theme: string;
	    fontSize: string;
	
	    static createFrom(source: any = {}) {
	        return new Appearance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.fontSize = source["fontSize"];
	    }
	}
	export class HistoryConf {
	    maxEntries: number;
	
	    static createFrom(source: any = {}) {
	        return new HistoryConf(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxEntries = source["maxEntries"];
	    }
	}
	export class Download {
	    sourcePref: string;
	
	    static createFrom(source: any = {}) {
	        return new Download(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourcePref = source["sourcePref"];
	    }
	}
	export class Resource {
	    idleUnloadMinutes: number;
	    closeBehavior: string;
	
	    static createFrom(source: any = {}) {
	        return new Resource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.idleUnloadMinutes = source["idleUnloadMinutes"];
	        this.closeBehavior = source["closeBehavior"];
	    }
	}
	export class Inference {
	    nglOverride: number;
	    ctxTier: string;
	    ctxTokensOverride: number;
	    cpuThreads: number;
	    tempOverride: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Inference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nglOverride = source["nglOverride"];
	        this.ctxTier = source["ctxTier"];
	        this.ctxTokensOverride = source["ctxTokensOverride"];
	        this.cpuThreads = source["cpuThreads"];
	        this.tempOverride = source["tempOverride"];
	    }
	}
	export class Config {
	    loggingEnabled: boolean;
	    inference: Inference;
	    resource: Resource;
	    download: Download;
	    appearance: Appearance;
	    history: HistoryConf;
	    onboarded: boolean;
	    activeModel: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loggingEnabled = source["loggingEnabled"];
	        this.inference = this.convertValues(source["inference"], Inference);
	        this.resource = this.convertValues(source["resource"], Resource);
	        this.download = this.convertValues(source["download"], Download);
	        this.appearance = this.convertValues(source["appearance"], Appearance);
	        this.history = this.convertValues(source["history"], HistoryConf);
	        this.onboarded = source["onboarded"];
	        this.activeModel = source["activeModel"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	

}

export namespace docpipeline {
	
	export class ChunkState {
	    index: number;
	    text: string;
	    translated?: string;
	    state: string;
	
	    static createFrom(source: any = {}) {
	        return new ChunkState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.text = source["text"];
	        this.translated = source["translated"];
	        this.state = source["state"];
	    }
	}
	export class TermCoverage {
	    term: string;
	    translation: string;
	    sourceChunks: number;
	    hitChunks: number;
	    sourceOccurrences: number;
	    targetOccurrences: number;
	    missingChunks?: number[];
	
	    static createFrom(source: any = {}) {
	        return new TermCoverage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.term = source["term"];
	        this.translation = source["translation"];
	        this.sourceChunks = source["sourceChunks"];
	        this.hitChunks = source["hitChunks"];
	        this.sourceOccurrences = source["sourceOccurrences"];
	        this.targetOccurrences = source["targetOccurrences"];
	        this.missingChunks = source["missingChunks"];
	    }
	}
	export class Doc {
	    id: string;
	    path: string;
	    direction: string;
	    glossary?: translator.GlossaryItem[];
	    chunks: ChunkState[];
	    charsTotal: number;
	    coverage?: TermCoverage[];
	    queueActive?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Doc(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.direction = source["direction"];
	        this.glossary = this.convertValues(source["glossary"], translator.GlossaryItem);
	        this.chunks = this.convertValues(source["chunks"], ChunkState);
	        this.charsTotal = source["charsTotal"];
	        this.coverage = this.convertValues(source["coverage"], TermCoverage);
	        this.queueActive = source["queueActive"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace envprobe {
	
	export class ResidualSweepResult {
	    cleaned: string[];
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new ResidualSweepResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cleaned = source["cleaned"];
	        this.count = source["count"];
	    }
	}
	export class GPU {
	    present: boolean;
	    name: string;
	    totalMB: number;
	    usedMB: number;
	    freeMB: number;
	    driverOK: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GPU(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.present = source["present"];
	        this.name = source["name"];
	        this.totalMB = source["totalMB"];
	        this.usedMB = source["usedMB"];
	        this.freeMB = source["freeMB"];
	        this.driverOK = source["driverOK"];
	    }
	}
	export class EnvInfo {
	    gpu: GPU;
	    webView2Present: boolean;
	    webView2Version: string;
	    llamaServerPath: string;
	    llamaServerOK: boolean;
	    modelsDir: string;
	    cpuLogicalCores: number;
	    cpuModel: string;
	    sweep: ResidualSweepResult;
	    probedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new EnvInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gpu = this.convertValues(source["gpu"], GPU);
	        this.webView2Present = source["webView2Present"];
	        this.webView2Version = source["webView2Version"];
	        this.llamaServerPath = source["llamaServerPath"];
	        this.llamaServerOK = source["llamaServerOK"];
	        this.modelsDir = source["modelsDir"];
	        this.cpuLogicalCores = source["cpuLogicalCores"];
	        this.cpuModel = source["cpuModel"];
	        this.sweep = this.convertValues(source["sweep"], ResidualSweepResult);
	        this.probedAt = source["probedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace main {
	
	export class CtxEstimate {
	    tokens: number;
	    weightsMiB: number;
	    kvMiB: number;
	    activateMiB: number;
	    totalMiB: number;
	    gpu: envprobe.GPU;
	    exceedsFree: boolean;
	    basis: string;
	
	    static createFrom(source: any = {}) {
	        return new CtxEstimate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tokens = source["tokens"];
	        this.weightsMiB = source["weightsMiB"];
	        this.kvMiB = source["kvMiB"];
	        this.activateMiB = source["activateMiB"];
	        this.totalMiB = source["totalMiB"];
	        this.gpu = this.convertValues(source["gpu"], envprobe.GPU);
	        this.exceedsFree = source["exceedsFree"];
	        this.basis = source["basis"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DocPickResult {
	    path: string;
	    chars: number;
	    tooLong: boolean;
	    unsupported: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DocPickResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.chars = source["chars"];
	        this.tooLong = source["tooLong"];
	        this.unsupported = source["unsupported"];
	    }
	}
	export class DocRequestUI {
	    path: string;
	    direction: string;
	    glossaryId?: number;
	
	    static createFrom(source: any = {}) {
	        return new DocRequestUI(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.direction = source["direction"];
	        this.glossaryId = source["glossaryId"];
	    }
	}
	export class LogCleanupResult {
	    removed: number;
	    skipped: string[];
	
	    static createFrom(source: any = {}) {
	        return new LogCleanupResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.removed = source["removed"];
	        this.skipped = source["skipped"];
	    }
	}
	export class SystemStatus {
	    orchestration: string;
	    activeModel: string;
	    runningModel: string;
	    loadedCtxTokens: number;
	    port: number;
	    gpu: envprobe.GPU;
	    idleMinutes: number;
	    idleSeconds: number;
	    idleReleaseSeconds: number;
	    activeTasks: number;
	    version: string;
	    offline: boolean;
	    models: modelmanager.ModelInfo[];
	
	    static createFrom(source: any = {}) {
	        return new SystemStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.orchestration = source["orchestration"];
	        this.activeModel = source["activeModel"];
	        this.runningModel = source["runningModel"];
	        this.loadedCtxTokens = source["loadedCtxTokens"];
	        this.port = source["port"];
	        this.gpu = this.convertValues(source["gpu"], envprobe.GPU);
	        this.idleMinutes = source["idleMinutes"];
	        this.idleSeconds = source["idleSeconds"];
	        this.idleReleaseSeconds = source["idleReleaseSeconds"];
	        this.activeTasks = source["activeTasks"];
	        this.version = source["version"];
	        this.offline = source["offline"];
	        this.models = this.convertValues(source["models"], modelmanager.ModelInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TaskHandle {
	    taskId: string;
	
	    static createFrom(source: any = {}) {
	        return new TaskHandle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskId = source["taskId"];
	    }
	}
	export class TranslateRequestUI {
	    sourceLang: string;
	    targetLang: string;
	    text: string;
	    dubbing?: boolean;
	    syllables?: number;
	    glossaryId?: number;
	    hard?: string[];
	    soft?: string[];
	    genre?: string;
	    jsonPreserve?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TranslateRequestUI(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceLang = source["sourceLang"];
	        this.targetLang = source["targetLang"];
	        this.text = source["text"];
	        this.dubbing = source["dubbing"];
	        this.syllables = source["syllables"];
	        this.glossaryId = source["glossaryId"];
	        this.hard = source["hard"];
	        this.soft = source["soft"];
	        this.genre = source["genre"];
	        this.jsonPreserve = source["jsonPreserve"];
	    }
	}

}

export namespace modelmanager {
	
	export class DownloadLocation {
	    path: string;
	    freeBytes: number;
	    known: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DownloadLocation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.freeBytes = source["freeBytes"];
	        this.known = source["known"];
	    }
	}
	export class DownloadProgress {
	    modelId: string;
	    quant: string;
	    phase: string;
	    bytesDone: number;
	    bytesTotal: number;
	    speedBPS: number;
	    source: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.modelId = source["modelId"];
	        this.quant = source["quant"];
	        this.phase = source["phase"];
	        this.bytesDone = source["bytesDone"];
	        this.bytesTotal = source["bytesTotal"];
	        this.speedBPS = source["speedBPS"];
	        this.source = source["source"];
	        this.message = source["message"];
	    }
	}
	export class QuantStatus {
	    quant: string;
	    present: boolean;
	    path?: string;
	    sizeBytes: number;
	    sha256?: string;
	
	    static createFrom(source: any = {}) {
	        return new QuantStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.quant = source["quant"];
	        this.present = source["present"];
	        this.path = source["path"];
	        this.sizeBytes = source["sizeBytes"];
	        this.sha256 = source["sha256"];
	    }
	}
	export class ModelInfo {
	    id: string;
	    name: string;
	    role: string;
	    languages: string;
	    repo: string;
	    state: string;
	    active: boolean;
	    port?: number;
	    quants: QuantStatus[];
	    source?: string;
	    idleSec?: number;
	    download?: DownloadProgress;
	    isUnknown?: boolean;
	    path?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.role = source["role"];
	        this.languages = source["languages"];
	        this.repo = source["repo"];
	        this.state = source["state"];
	        this.active = source["active"];
	        this.port = source["port"];
	        this.quants = this.convertValues(source["quants"], QuantStatus);
	        this.source = source["source"];
	        this.idleSec = source["idleSec"];
	        this.download = this.convertValues(source["download"], DownloadProgress);
	        this.isUnknown = source["isUnknown"];
	        this.path = source["path"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class GlossaryItemEnt {
	    term: string;
	    translation: string;
	
	    static createFrom(source: any = {}) {
	        return new GlossaryItemEnt(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.term = source["term"];
	        this.translation = source["translation"];
	    }
	}
	export class Glossary {
	    id: number;
	    name: string;
	    items: GlossaryItemEnt[];
	
	    static createFrom(source: any = {}) {
	        return new Glossary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.items = this.convertValues(source["items"], GlossaryItemEnt);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class HistoryItem {
	    id: number;
	    createdAt: number;
	    sourceLang: string;
	    targetLang: string;
	    sourceText: string;
	    output: string;
	    model: string;
	    mode: string;
	    starred: boolean;
	
	    static createFrom(source: any = {}) {
	        return new HistoryItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.createdAt = source["createdAt"];
	        this.sourceLang = source["sourceLang"];
	        this.targetLang = source["targetLang"];
	        this.sourceText = source["sourceText"];
	        this.output = source["output"];
	        this.model = source["model"];
	        this.mode = source["mode"];
	        this.starred = source["starred"];
	    }
	}

}

export namespace subtitle {
	
	export class Cue {
	    index: number;
	    startMs: number;
	    endMs: number;
	    original: string;
	    translated: string;
	    styleName?: string;
	    state: string;
	    offTarget?: boolean;
	    needsCheck?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Cue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.startMs = source["startMs"];
	        this.endMs = source["endMs"];
	        this.original = source["original"];
	        this.translated = source["translated"];
	        this.styleName = source["styleName"];
	        this.state = source["state"];
	        this.offTarget = source["offTarget"];
	        this.needsCheck = source["needsCheck"];
	    }
	}
	export class CuePatch {
	    startMs?: number;
	    endMs?: number;
	    original?: string;
	    translated?: string;
	    styleName?: string;
	
	    static createFrom(source: any = {}) {
	        return new CuePatch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startMs = source["startMs"];
	        this.endMs = source["endMs"];
	        this.original = source["original"];
	        this.translated = source["translated"];
	        this.styleName = source["styleName"];
	    }
	}
	export class ExportOptions {
	    format: string;
	    encoding: string;
	    bilingual: string;
	    outPath: string;
	
	    static createFrom(source: any = {}) {
	        return new ExportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.encoding = source["encoding"];
	        this.bilingual = source["bilingual"];
	        this.outPath = source["outPath"];
	    }
	}
	export class GlossaryTerm {
	    Term: string;
	    Translation: string;
	
	    static createFrom(source: any = {}) {
	        return new GlossaryTerm(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Term = source["Term"];
	        this.Translation = source["Translation"];
	    }
	}
	export class QueueOptions {
	    targetLang: string;
	    glossaryId?: number;
	    bilingual: string;
	    full?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new QueueOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetLang = source["targetLang"];
	        this.glossaryId = source["glossaryId"];
	        this.bilingual = source["bilingual"];
	        this.full = source["full"];
	    }
	}
	export class StyleDef {
	    name: string;
	    fontName: string;
	    fontSize: number;
	    primaryRGB: string;
	    outlineRGB: string;
	    outline: number;
	    bold: boolean;
	    alignment: number;
	    marginV: number;
	
	    static createFrom(source: any = {}) {
	        return new StyleDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.fontName = source["fontName"];
	        this.fontSize = source["fontSize"];
	        this.primaryRGB = source["primaryRGB"];
	        this.outlineRGB = source["outlineRGB"];
	        this.outline = source["outline"];
	        this.bold = source["bold"];
	        this.alignment = source["alignment"];
	        this.marginV = source["marginV"];
	    }
	}
	export class SubtitleDoc {
	    revision: number;
	    id: string;
	    path: string;
	    format: string;
	    encoding: string;
	    cues: Cue[];
	    styles?: StyleDef[];
	    queueActive?: boolean;
	    queuePaused: boolean;
	    canUndo: boolean;
	    canRedo: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SubtitleDoc(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.revision = source["revision"];
	        this.id = source["id"];
	        this.path = source["path"];
	        this.format = source["format"];
	        this.encoding = source["encoding"];
	        this.cues = this.convertValues(source["cues"], Cue);
	        this.styles = this.convertValues(source["styles"], StyleDef);
	        this.queueActive = source["queueActive"];
	        this.queuePaused = source["queuePaused"];
	        this.canUndo = source["canUndo"];
	        this.canRedo = source["canRedo"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace translator {
	
	export class GlossaryItem {
	    term: string;
	    translation: string;
	
	    static createFrom(source: any = {}) {
	        return new GlossaryItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.term = source["term"];
	        this.translation = source["translation"];
	    }
	}
	export class Lang {
	    code: string;
	    zhName: string;
	    enName: string;
	    script: string;
	    core?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Lang(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.zhName = source["zhName"];
	        this.enName = source["enName"];
	        this.script = source["script"];
	        this.core = source["core"];
	    }
	}

}

