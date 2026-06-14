import { Navigate, Route, Routes } from "react-router-dom";
import { SessionPage } from "./SessionPage";

export function App() {
  return (
    <Routes>
      <Route path="/session/:sessionId" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
