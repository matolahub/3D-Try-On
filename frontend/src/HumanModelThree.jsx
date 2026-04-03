import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export default function HumanModelThree() {
  const mountRef = useRef(null);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [loading, setLoading] = useState(true);
  const modelRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);

  // Applica la rotazione manuale via slider
  useEffect(() => {
    if (modelRef.current) {
      modelRef.current.rotation.y = -rotationAngle;
    }
  }, [rotationAngle, modelRef.current]); // Aggiungi modelRef.current come dipendenza

  useEffect(() => {
    // SCENA
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d0d0d");
    sceneRef.current = scene; // Assegna la scena al ref per un accesso esterno/pulizia successiva
    const currentSceneInstance = scene; // Cattura l'istanza della scena in una variabile locale

    // CARICAMENTO MODELLO GLB
    const loader = new GLTFLoader();

    loader.load(
      "/assets/man-model.glb",
      (gltf) => {
    const model = gltf.scene;

    // Ruota il modello per metterlo in piedi se necessario
    model.rotation.x = -Math.PI / 2;

    // Centratura e framing dopo la rotazione
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x += (model.position.x - center.x);
    model.position.z += (model.position.z - center.z);
    model.position.y -= box.min.y; // Appoggia i piedi a terra

    currentSceneInstance.add(model); // Usa la variabile locale catturata
    modelRef.current = model;
        setLoading(false);
        
        // Applica la rotazione iniziale del modello dopo il caricamento
        if (modelRef.current) {
          modelRef.current.rotation.y = -rotationAngle;
        }
      },
      undefined,
      (error) => {
        console.error("Errore caricamento modello:", error);
        setLoading(false);
      }
    );

    // ... (rest of the effect cleanup)

  }, []); // Mantieni l'array vuoto per l'inizializzazione della scena

  return (
    <div className="v-tryon-container">
      {loading && (
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Caricamento Modello...</p>
        </div>
      )}

      <div ref={mountRef} className="canvas-container"></div>

      <div className="ui-overlay">
        <header className="v-tryon-header">
          <h1>Virtual Try-On</h1>
          <p>Esplora il modello 3D</p>
        </header>

        <div className="controls-panel">
          <div className="control-group">
            <div className="control-label">
              <span>Rotazione Corpo</span>
              <span className="value-badge">{(rotationAngle * 180 / Math.PI).toFixed(0)}°</span>
            </div>
            <input
              type="range"
              min={-Math.PI}
              max={Math.PI}
              step="0.01"
              value={rotationAngle}
              onChange={(e) => setRotationAngle(parseFloat(e.target.value))}
              className="modern-slider"
            />
          </div>
          
          <button className="reset-btn" onClick={() => setRotationAngle(0)}>
            Ripristina Vista
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .v-tryon-container {
          position: relative;
          width: 100%;
          height: 100vh;
          background: radial-gradient(circle at center, #1a1a1a 0%, #050505 100%);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: white;
          overflow: hidden;
        }

        .canvas-container {
          width: 100%;
          height: 100%;
        }

        .loading-screen {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #0d0d0d;
          z-index: 100;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top: 3px solid #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 15px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .ui-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 40px;
        }

        .v-tryon-header {
          pointer-events: auto;
        }

        .v-tryon-header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
          text-transform: uppercase;
        }

        .v-tryon-header p {
          margin: 5px 0 0;
          opacity: 0.5;
          font-size: 14px;
        }

        .controls-panel {
          pointer-events: auto;
          align-self: center;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          padding: 24px;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          width: 100%;
          max-width: 400px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .control-group {
          margin-bottom: 20px;
        }

        .control-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          font-size: 14px;
          font-weight: 500;
        }

        .value-badge {
          background: #3b82f6;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }

        .modern-slider {
          -webkit-appearance: none;
          width: 100%;
          height: 4px;
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
          outline: none;
        }

        .modern-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          background: white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
          transition: all 0.2s ease;
        }

        .modern-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          background: #3b82f6;
        }

        .reset-btn {
          width: 100%;
          padding: 12px;
          background: white;
          color: black;
          border: none;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .reset-btn:hover {
          background: #3b82f6;
          color: white;
        }

        @media (max-width: 600px) {
          .ui-overlay { padding: 20px; }
          .controls-panel { width: calc(100% - 40px); }
        }
      `}} />
    </div>
  );
}