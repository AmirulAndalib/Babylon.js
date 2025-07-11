/* eslint-disable github/no-then */
/* eslint-disable @typescript-eslint/no-floating-promises */
import * as React from "react";
import type { GlobalState } from "../globalState";
import { RuntimeMode } from "../globalState";
import { Utilities } from "../tools/utilities";
import { DownloadManager } from "../tools/downloadManager";
import { Engine, EngineStore, WebGPUEngine, LastCreatedAudioEngine } from "@dev/core";

import type { Nullable, Scene } from "@dev/core";

import "../scss/rendering.scss";

// If the "inspectorv2" query parameter is present, preload (asynchronously) the new inspector v2 module.
const InspectorV2ModulePromise = new URLSearchParams(window.location.search).has("inspectorv2") ? import("inspector-v2/inspector") : null;

interface IRenderingComponentProps {
    globalState: GlobalState;
}

declare const Ammo: any;
declare const Recast: any;
declare const HavokPhysics: any;
declare const HK: any;

export class RenderingComponent extends React.Component<IRenderingComponentProps> {
    private _engine: Nullable<Engine>;
    private _scene: Nullable<Scene>;
    private _canvasRef: React.RefObject<HTMLCanvasElement>;
    private _downloadManager: DownloadManager;
    private _babylonToolkitWasLoaded = false;
    private _tmpErrorEvent?: ErrorEvent;
    private _inspectorFallback: boolean = false;

    public constructor(props: IRenderingComponentProps) {
        super(props);

        this._canvasRef = React.createRef();

        // Create the global handleException
        (window as any).handleException = (e: Error) => {
            // eslint-disable-next-line no-console
            console.error(e);
            this.props.globalState.onErrorObservable.notifyObservers(e);
        };

        this.props.globalState.onRunRequiredObservable.add(() => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this._compileAndRunAsync();
        });

        this._downloadManager = new DownloadManager(this.props.globalState);
        this.props.globalState.onDownloadRequiredObservable.add(() => {
            if (!this._engine) {
                return;
            }
            this._downloadManager.download(this._engine);
        });

        this.props.globalState.onInspectorRequiredObservable.add(async () => {
            if (!this._scene) {
                return;
            }

            if (InspectorV2ModulePromise) {
                const inspectorV2Module = await InspectorV2ModulePromise;
                if (inspectorV2Module.IsInspectorVisible()) {
                    inspectorV2Module.HideInspector();
                } else {
                    inspectorV2Module.ShowInspector(this._scene, {
                        embedMode: true,
                    });
                }
            } else {
                // support for older versions
                // openedPanes was not available until 7.44.0, so we need to fallback to the inspector's _OpenedPane property
                if (this._scene.debugLayer.openedPanes === undefined) {
                    this._inspectorFallback = true;
                }

                // fallback?
                if (this._inspectorFallback) {
                    const debugLayer: any = this._scene.debugLayer;
                    debugLayer.openedPanes = debugLayer.BJSINSPECTOR?.Inspector?._OpenedPane || 0;
                }

                if (this._scene.debugLayer.openedPanes === 0) {
                    this._scene.debugLayer.show({
                        embedMode: true,
                    });
                } else {
                    this._scene.debugLayer.hide();
                }
            }
        });

        this.props.globalState.onFullcreenRequiredObservable.add(() => {
            this._engine?.switchFullscreen(false);
        });

        window.addEventListener("resize", () => {
            if (!this._engine) {
                return;
            }

            this._engine.resize();
        });

        window.addEventListener("error", this._saveError);
    }

    private _saveError = (err: ErrorEvent) => {
        this._tmpErrorEvent = err;
    };

    private async _loadScriptAsync(url: string): Promise<void> {
        return await new Promise((resolve) => {
            const script = document.createElement("script");
            script.setAttribute("type", "text/javascript");
            script.setAttribute("src", url);
            script.onload = () => {
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    private _notifyError(message: string) {
        this.props.globalState.onErrorObservable.notifyObservers({
            message: message,
        });
        this.props.globalState.onDisplayWaitRingObservable.notifyObservers(false);
    }

    private _preventReentrancy = false;

    private async _compileAndRunAsync() {
        if (this._preventReentrancy) {
            return;
        }
        this._preventReentrancy = true;

        this.props.globalState.onErrorObservable.notifyObservers(null);

        const displayInspector = InspectorV2ModulePromise ? (await InspectorV2ModulePromise).IsInspectorVisible() : this._scene?.debugLayer.isVisible();

        const webgpuPromise = WebGPUEngine ? WebGPUEngine.IsSupportedAsync : Promise.resolve(false);
        const webGPUSupported = await webgpuPromise;

        let useWebGPU = location.search.indexOf("webgpu") !== -1 && webGPUSupported;
        let forceWebGL1 = false;
        const configuredEngine = Utilities.ReadStringFromStore("engineVersion", "WebGL2", true);

        switch (configuredEngine) {
            case "WebGPU":
                useWebGPU = true && webGPUSupported;
                break;
            case "WebGL":
                forceWebGL1 = true;
                break;
        }

        try {
            while (EngineStore.Instances.length) {
                EngineStore.Instances[0].dispose();
            }
            let audioEngine;
            while ((audioEngine = LastCreatedAudioEngine())) {
                audioEngine.dispose();
            }
        } catch (ex) {
            // just ignore
        }

        this._engine = null;

        try {
            // Set up the global object ("window" and "this" for user code).
            // Delete (or rewrite) previous-run globals to avoid confusion.
            const globalObject = window as any;
            delete globalObject.engine;
            delete globalObject.scene;
            delete globalObject.initFunction;

            const canvas = this._canvasRef.current!;
            globalObject.canvas = canvas;

            if (useWebGPU) {
                globalObject.createDefaultEngine = async function () {
                    try {
                        const engine = new WebGPUEngine(canvas, {
                            enableAllFeatures: true,
                            setMaximumLimits: true,
                            enableGPUDebugMarkers: true,
                        });
                        await engine.initAsync();
                        return engine;
                    } catch (e) {
                        // eslint-disable-next-line no-console
                        console.error("The Playground could not create a WebGPU engine instance. Make sure WebGPU is supported by your browser.");
                        // eslint-disable-next-line no-console
                        console.error(e);
                        return null;
                    }
                };
            } else {
                globalObject.createDefaultEngine = function () {
                    return new Engine(canvas, true, {
                        disableWebGL2Support: forceWebGL1,
                        preserveDrawingBuffer: true,
                        stencil: true,
                    });
                };
            }

            const zipVariables = "var engine = null;\r\nvar scene = null;\r\nvar sceneToRender = null;\r\n";
            let defaultEngineZip = `var createDefaultEngine = function() { return new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true,  disableWebGL2Support: ${forceWebGL1}}); }`;

            if (useWebGPU) {
                defaultEngineZip = `var createDefaultEngine = async function() { 
                    var engine = new BABYLON.WebGPUEngine(canvas);
                    await engine.initAsync();
                    return engine;
                }`;
            }

            let code = await this.props.globalState.getCompiledCode();

            if (!code) {
                this._preventReentrancy = false;
                return;
            }

            // Check for Ammo.js
            let ammoInit = "";
            if (code.indexOf("AmmoJSPlugin") > -1 && typeof Ammo === "function") {
                ammoInit = "await Ammo();";
            }

            // Check for Recast.js
            let recastInit = "";
            if (code.indexOf("RecastJSPlugin") > -1 && typeof Recast === "function") {
                recastInit = "await Recast();";
            }

            let havokInit = "";
            if (code.includes("HavokPlugin") && typeof HavokPhysics === "function" && typeof HK === "undefined") {
                havokInit = "globalThis.HK = await HavokPhysics();";
            }

            let audioInit = "";
            if (code.includes("BABYLON.Sound")) {
                audioInit =
                    "BABYLON.AbstractEngine.audioEngine = BABYLON.AbstractEngine.AudioEngineFactory(window.engine.getRenderingCanvas(), window.engine.getAudioContext(), window.engine.getAudioDestination());";
            }

            const babylonToolkit =
                !this._babylonToolkitWasLoaded &&
                (code.includes("BABYLON.Toolkit.SceneManager.InitializePlayground") ||
                    code.includes("SM.InitializePlayground") ||
                    location.href.indexOf("BabylonToolkit") !== -1 ||
                    Utilities.ReadBoolFromStore("babylon-toolkit", false));
            // Check for Babylon Toolkit
            if (babylonToolkit) {
                await this._loadScriptAsync("https://cdn.jsdelivr.net/gh/BabylonJS/BabylonToolkit@master/Runtime/babylon.toolkit.js");
                this._babylonToolkitWasLoaded = true;
            }
            Utilities.StoreBoolToStore("babylon-toolkit-used", babylonToolkit);

            let createEngineFunction = "createDefaultEngine";
            let createSceneFunction = "";
            let checkCamera = true;
            let checkSceneCount = true;

            if (code.indexOf("createEngine") !== -1) {
                createEngineFunction = "createEngine";
            }

            // Check for different typos
            if (code.indexOf("delayCreateScene") !== -1) {
                // delayCreateScene
                createSceneFunction = "delayCreateScene";
                checkCamera = false;
            } else if (code.indexOf("createScene") !== -1) {
                // createScene
                createSceneFunction = "createScene";
            } else if (code.indexOf("CreateScene") !== -1) {
                // CreateScene
                createSceneFunction = "CreateScene";
            } else if (code.indexOf("createscene") !== -1) {
                // createscene
                createSceneFunction = "createscene";
            }

            if (!createSceneFunction) {
                this._preventReentrancy = false;
                return this._notifyError("You must provide a function named createScene.");
            } else {
                // Write an "initFunction" that creates engine and scene
                // using the appropriate default or user-provided functions.
                // (Use "window.x = foo" to allow later deletion, see above.)
                code += `
                window.initFunction = async function() {
                    ${ammoInit}
                    ${havokInit}
                    ${recastInit}
                    var asyncEngineCreation = async function() {
                        try {
                        return ${createEngineFunction}();
                        } catch(e) {
                        console.log("the available createEngine function failed. Creating the default engine instead");
                        return createDefaultEngine();
                        }
                    }

                    window.engine = await asyncEngineCreation();
                    
                    const engineOptions = window.engine.getCreationOptions?.();
                    if (!engineOptions || engineOptions.audioEngine !== false) {
                        ${audioInit}
                    }`;
                code += "\r\nif (!engine) throw 'engine should not be null.';";

                globalObject.startRenderLoop = (engine: Engine, canvas: HTMLCanvasElement) => {
                    engine.runRenderLoop(() => {
                        if (!this._scene || !this._engine) {
                            return;
                        }

                        if (this.props.globalState.runtimeMode === RuntimeMode.Editor && window.innerWidth > this.props.globalState.MobileSizeTrigger) {
                            if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
                                this._engine.resize();
                            }
                        }

                        if (this._scene.activeCamera || this._scene.frameGraph || (this._scene.activeCameras && this._scene.activeCameras.length > 0)) {
                            this._scene.render();
                        }

                        // Update FPS if camera is not a webxr camera
                        if (!(this._scene.activeCamera && this._scene.activeCamera.getClassName && this._scene.activeCamera.getClassName() === "WebXRCamera")) {
                            if (this.props.globalState.runtimeMode !== RuntimeMode.Full) {
                                this.props.globalState.fpsElement.innerHTML = this._engine.getFps().toFixed() + " fps";
                            }
                        }
                    });
                };
                code += "\r\nstartRenderLoop(engine, canvas);";

                if (this.props.globalState.language === "JS") {
                    code += "\r\n" + "window.scene = " + createSceneFunction + "();";
                } else {
                    const startCar = code.search("var " + createSceneFunction);
                    code = code.substring(0, startCar) + code.substr(startCar + 4);
                    code += "\n" + "window.scene = " + createSceneFunction + "();";
                }

                code += `}`; // Finish "initFunction" definition.

                this._tmpErrorEvent = undefined;

                try {
                    // Execute the code
                    Utilities.FastEval(code);
                } catch (e) {
                    (window as any).handleException(e);
                }

                await globalObject.initFunction();

                this._engine = globalObject.engine;

                if (!this._engine) {
                    this._preventReentrancy = false;
                    return this._notifyError("createEngine function must return an engine.");
                }

                if (!globalObject.scene) {
                    this._preventReentrancy = false;
                    return this._notifyError("createScene function must return a scene.");
                }

                let sceneToRenderCode = "sceneToRender = scene";

                // if scene returns a promise avoid checks
                if (globalObject.scene.then) {
                    checkCamera = false;
                    checkSceneCount = false;
                    sceneToRenderCode = "scene.then(returnedScene => { sceneToRender = returnedScene; });\r\n";
                }

                const createEngineZip = createEngineFunction === "createEngine" ? zipVariables : zipVariables + defaultEngineZip;

                this.props.globalState.zipCode = createEngineZip + ";\r\n" + code + ";\r\ninitFunction().then(() => {" + sceneToRenderCode;
            }

            if (globalObject.scene.then) {
                globalObject.scene.then((s: Scene) => {
                    this._scene = s;
                    globalObject.scene = this._scene;
                });
            } else {
                this._scene = globalObject.scene as Scene;
            }

            if (checkSceneCount && this._engine.scenes.length === 0) {
                this._preventReentrancy = false;
                return this._notifyError("You must at least create a scene.");
            }

            if (this._engine.scenes[0] && displayInspector && !globalObject.scene.then) {
                this.props.globalState.onInspectorRequiredObservable.notifyObservers();
            }

            if (checkCamera && this._engine.scenes[0].activeCamera == null) {
                this._preventReentrancy = false;
                return this._notifyError("You must at least create a camera.");
            } else if (globalObject.scene.then) {
                globalObject.scene.then(
                    () => {
                        if (this._engine!.scenes[0] && displayInspector) {
                            this.props.globalState.onInspectorRequiredObservable.notifyObservers();
                        }
                        this._engine!.scenes[0].executeWhenReady(() => {
                            this.props.globalState.onRunExecutedObservable.notifyObservers();
                        });
                        this._preventReentrancy = false;
                    },
                    (err: any) => {
                        // eslint-disable-next-line no-console
                        console.error(err);
                        this._preventReentrancy = false;
                    }
                );
            } else {
                this._engine.scenes[0].executeWhenReady(() => {
                    this.props.globalState.onRunExecutedObservable.notifyObservers();
                });
                this._preventReentrancy = false;
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(err, "Retrying if possible. If this error persists please notify the team.");
            this.props.globalState.onErrorObservable.notifyObservers(this._tmpErrorEvent || err);
            this._preventReentrancy = false;
        }
        this.props.globalState.onDisplayWaitRingObservable.notifyObservers(false);
    }

    public override render() {
        return <canvas id="renderCanvas" ref={this._canvasRef}></canvas>;
    }
}
