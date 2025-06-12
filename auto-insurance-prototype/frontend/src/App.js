import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { AppLayout, Container } from "@cloudscape-design/components";

import Navigation from "./components/Navigation";
import Dashboard from "./pages/Dashboard";
import QuoteForm from "./pages/QuoteForm";
import QuoteResult from "./pages/QuoteResult";
import CustomerProfile from "./pages/CustomerProfile";
import ChatQuote from "./pages/ChatQuote";
import AgentTraceViewer from "./pages/AgentTraceViewer";

function App() {
    return (
        <Router>
            <AppLayoutWithNavigation />
        </Router>
    );
}

// This component is defined inside the Router context
function AppLayoutWithNavigation() {
    return (
        <AppLayout
            navigation={<Navigation />}
            content={
                <Container>
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/quote" element={<QuoteForm />} />
                        <Route path="/chat-quote" element={<ChatQuote />} />
                        <Route path="/quote-result" element={<QuoteResult />} />
                        <Route path="/profile" element={<CustomerProfile />} />
                        <Route path="/agent-traces" element={<AgentTraceViewer />} />
                    </Routes>
                </Container>
            }
            toolsHide={true}
        />
    );
}

export default App;
