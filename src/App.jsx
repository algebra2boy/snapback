import AuthGuard from "@/components/AuthGuard";
import PolymarketRelativeValueTerminal from "./PolymarketRelativeValueTerminal.jsx";

export default function App() {
  return (
    <AuthGuard>
      <PolymarketRelativeValueTerminal />
    </AuthGuard>
  );
}
