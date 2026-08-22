import { BrowserRouter, Routes, Route } from "react-router-dom";
import MultiviewPage from "./pages/MultiviewPage.js";
import SavedPage from "./pages/SavedPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MultiviewPage />} />
        <Route path="/saved" element={<SavedPage />} />
      </Routes>
    </BrowserRouter>
  );
}
