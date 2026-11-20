import { BrowserRouter } from "react-router";
import { AppRoutes } from "./routes";
import { ToastHost } from "./ui/Toast";

export function App() {
  return (
    <BrowserRouter>
      <ToastHost>
        <AppRoutes />
      </ToastHost>
    </BrowserRouter>
  );
}
