import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import Chat from "./pages/Chat.tsx";
import Login from "./pages/Login.tsx";
import NotFound from "./pages/NotFound.tsx";
import SignUp from "./pages/SignUp.tsx";
import { AuthProvider } from "./auth/AuthContext.tsx";
import ProtectedRoute from "./auth/ProtectedRoute.tsx";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
    errorElement: <NotFound />,
  },
  {
    path: "/signup",
    element: <SignUp />,
    errorElement: <NotFound />,
  },
  {
    path: "/chat",
    element: <ProtectedRoute><Chat /></ProtectedRoute>,
    errorElement: <NotFound />,
    children: [
      {
        path: "/chat/:chatId",
        element: <ProtectedRoute><Chat /></ProtectedRoute>,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider><RouterProvider router={router} /></AuthProvider>
  </StrictMode>,
);
