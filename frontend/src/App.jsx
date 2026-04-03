import ClaudeScene from "./ThreeSceneTest";
import GeminiScene from "./HumanModelThree";

function App() {
  //return <GeminiScene />;
  return <ClaudeScene modelUrl="/assets/man-model.glb"/>;
}

export default App;