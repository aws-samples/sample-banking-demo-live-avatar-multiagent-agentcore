import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/hooks/useTheme";
import { ModelSelectorProvider } from "@/hooks/useModelSelector";
import Spinner from "@cloudscape-design/components/spinner";
import Box from "@cloudscape-design/components/box";

const HomePage = lazy(() => import("@/routes/HomePage"));
const ResearchPage = lazy(() => import("@/routes/ResearchPage"));
const ChatPage = lazy(() => import("@/routes/ChatPage"));
const MenuPage = lazy(() => import("@/routes/MenuPage"));
const AvatarPage = lazy(() => import("@/routes/AvatarPage"));
const ResearchStudioPage = lazy(() => import("@/routes/ResearchStudioPage"));
const ArchivePage = lazy(() => import("@/routes/ArchivePage"));

function LoadingFallback(): JSX.Element {
    return (
        <div className="flex items-center justify-center h-full">
            <Box textAlign="center">
                <Spinner size="large" />
            </Box>
        </div>
    );
}

export default function App(): JSX.Element {
    return (
        <BrowserRouter>
            <ThemeProvider>
                <ModelSelectorProvider>
                    <AuthProvider>
                        <Suspense fallback={<LoadingFallback />}>
                            <Routes>
                                <Route path="/" element={<HomePage />} />
                                <Route
                                    element={
                                        <AppShell>
                                            <Outlet />
                                        </AppShell>
                                    }
                                >
                                    <Route path="/research" element={<ResearchPage />} />
                                    <Route path="/chat" element={<ChatPage />} />
                                    <Route path="/menu" element={<MenuPage />} />
                                    <Route path="/avatar" element={<AvatarPage />} />
                                    <Route
                                        path="/research-studio"
                                        element={<ResearchStudioPage />}
                                    />
                                    <Route path="/archive" element={<ArchivePage />} />
                                </Route>
                                <Route path="*" element={<Navigate to="/research" replace />} />
                            </Routes>
                        </Suspense>
                    </AuthProvider>
                </ModelSelectorProvider>
            </ThemeProvider>
        </BrowserRouter>
    );
}
