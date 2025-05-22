import React from "react";
import "./Sidebar.css";

interface SidebarProps {
    activeJourneyType: string;
    onJourneyTypeChange: (journeyType: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeJourneyType, onJourneyTypeChange }) => {
    return (
        <div className="journey-sidebar">
            <button className="sidebar-toggle">≡</button>
            <div className="sidebar-header">
                <h3>Journey Navigation</h3>
            </div>
            <ul className="journey-options">
                <li
                    className={`journey-option ${activeJourneyType === "standard" ? "active" : ""}`}
                    onClick={() => onJourneyTypeChange("standard")}
                >
                    <div className="option-icon standard">◆</div>
                    <div>
                        <div className="option-label">Standard Journey</div>
                        <div className="option-description">Step-by-step navigation</div>
                    </div>
                </li>
                <li
                    className={`journey-option ${activeJourneyType === "scroll" ? "active" : ""}`}
                    onClick={() => onJourneyTypeChange("scroll")}
                >
                    <div className="option-icon scroll">◆</div>
                    <div>
                        <div className="option-label">Scroll Journey</div>
                        <div className="option-description">Animations triggered by scrolling</div>
                    </div>
                </li>
                <li
                    className={`journey-option ${activeJourneyType === "timeline" ? "active" : ""}`}
                    onClick={() => onJourneyTypeChange("timeline")}
                >
                    <div className="option-icon timeline">◆</div>
                    <div>
                        <div className="option-label">Timeline Journey</div>
                        <div className="option-description">Sequential timeline animations</div>
                    </div>
                </li>
            </ul>
        </div>
    );
};

export default Sidebar;
