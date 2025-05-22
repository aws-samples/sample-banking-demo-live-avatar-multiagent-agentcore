import React, { useEffect, useRef, useState } from "react";
import anime from "animejs";
import { AnimeInstance } from "animejs";
import "./Chat.css";
import Sidebar from "./Sidebar";
import ScrollJourney from "./ScrollJourney";
import TimelineJourney from "./TimelineJourney";

const Chat: React.FC = () => {
    const [currentJourneyStep, setCurrentJourneyStep] = useState(0);
    const [narratorText, setNarratorText] = useState(
        "Welcome to the Amazon Bedrock All Up demo journey."
    );
    const [showNextButton, setShowNextButton] = useState(true);
    const [progress, setProgress] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [journeyType, setJourneyType] = useState("standard"); // 'standard', 'scroll', or 'timeline'
    const journeyContainerRef = useRef<HTMLDivElement>(null);

    // Journey steps
    const journeySteps = [
        { id: "intro", title: "Introduction" },
        { id: "part1-problem", title: "Problem Statement" },
        { id: "part1-scene1", title: "Model Catalog" },
        { id: "part1-scene2", title: "Playground Comparison" },
        { id: "part1-scene3", title: "Knowledge Base" },
        { id: "part1-scene4", title: "Model Evaluation" },
        { id: "part2-scene1", title: "Creating the Agent" },
        { id: "part2-scene2", title: "Web Integration" },
        { id: "part3-scene1", title: "Prompt Caching" },
        { id: "part3-scene2", title: "Prompt Routing" },
        { id: "part3-scene3", title: "Testing Optimizations" },
    ];

    // Initialize animations
    useEffect(() => {
        // Start with intro animation
        animateStep("intro");

        // Add event listeners for keyboard navigation
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") navigateJourney("next");
            if (e.key === "ArrowLeft") navigateJourney("prev");
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Handle journey navigation
    const navigateJourney = (direction: "next" | "prev") => {
        console.log(`Navigation button clicked: ${direction}`);

        // If already transitioning, don't allow another navigation
        if (isTransitioning) {
            console.log("Already transitioning, ignoring click");
            return;
        }

        let nextStep;

        if (direction === "next") {
            nextStep = Math.min(currentJourneyStep + 1, journeySteps.length - 1);
        } else {
            nextStep = Math.max(currentJourneyStep - 1, 0);
        }

        console.log(`Current step: ${currentJourneyStep}, Next step: ${nextStep}`);

        if (nextStep !== currentJourneyStep) {
            setCurrentJourneyStep(nextStep);
            animateStep(journeySteps[nextStep].id);

            // Show "Next" button for all steps except the last one of each part
            setShowNextButton(
                nextStep !== 5 && nextStep !== 7 && nextStep !== journeySteps.length - 1
            );
        }
    };

    // Animate a specific step
    const animateStep = (stepId: string) => {
        console.log(`Animating step: ${stepId}`);
        if (!journeyContainerRef.current) {
            console.error("Journey container ref is null");
            return;
        }

        // First, make sure all sections are hidden
        document.querySelectorAll(".journey-section").forEach((section) => {
            (section as HTMLElement).style.opacity = "0";
            (section as HTMLElement).classList.remove("active");
        });

        // Short delay to ensure sections are hidden
        setTimeout(() => {
            // Then show and animate the current section
            const currentSection = document.querySelector(`.journey-section.${stepId}`);
            if (currentSection) {
                currentSection.classList.add("active");
                anime({
                    targets: `.journey-section.${stepId}`,
                    opacity: [0, 1],
                    translateY: [20, 0],
                    duration: 800,
                    easing: "easeOutQuad",
                });

                // Update narrator text based on step
                updateNarratorText(stepId);

                // Animate elements within the section
                animateStepElements(stepId);
            } else {
                console.error(`Section with ID ${stepId} not found`);
            }
        }, 300);
    };

    // Handle direct navigation to a specific step
    const navigateToStep = (stepIndex: number) => {
        console.log(`Direct navigation to step: ${stepIndex}`);

        // If already transitioning, don't allow another navigation
        if (isTransitioning) {
            console.log("Already transitioning, ignoring click");
            return;
        }

        // Set transitioning state to prevent multiple clicks
        setIsTransitioning(true);

        // Animate progress indicator
        setProgress(0);
        anime({
            targets: ".progress-indicator-bar",
            width: ["0%", "100%"],
            duration: 800,
            easing: "linear",
            update: function (anim: AnimeInstance) {
                setProgress(Math.round(anim.progress));
            },
            complete: function () {
                // Update step after progress animation completes
                setCurrentJourneyStep(stepIndex);

                // Get the step ID from the journeySteps array
                const stepId = journeySteps[stepIndex].id;
                console.log(`Animating to step ID: ${stepId}`);

                // Animate the step
                animateStep(stepId);

                // Show "Next" button for all steps except the last one of each part
                setShowNextButton(
                    stepIndex !== 5 && stepIndex !== 7 && stepIndex !== journeySteps.length - 1
                );

                // Reset transitioning state
                setTimeout(() => {
                    setIsTransitioning(false);
                }, 500);
            },
        });
    };

    // Animate elements within a step
    const animateStepElements = (stepId: string) => {
        switch (stepId) {
            case "intro":
                anime({
                    targets: ".intro .title, .intro .subtitle",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(200),
                    duration: 800,
                });

                anime({
                    targets: ".intro-description p",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300, { start: 400 }),
                    duration: 800,
                });
                break;

            case "part1-problem":
                anime({
                    targets: ".problem-statement li",
                    opacity: [0, 1],
                    translateX: [20, 0],
                    delay: anime.stagger(200),
                    duration: 600,
                });

                // Animate Sarah Chen's profile
                anime({
                    targets: ".sarah-profile",
                    opacity: [0, 1],
                    scale: [0.9, 1],
                    delay: 1000,
                    duration: 800,
                });
                break;

            case "part1-scene1":
                // Animate model cards appearing
                anime({
                    targets: ".model-card",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });

                anime({
                    targets: ".model-details li",
                    opacity: [0, 1],
                    translateX: [20, 0],
                    delay: anime.stagger(200, { start: 800 }),
                    duration: 600,
                });
                break;

            case "part1-scene2":
                // Animate playground comparison
                anime({
                    targets: ".playground-comparison .model-response",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(500),
                    duration: 800,
                });
                break;

            case "part1-scene3":
                // Animate knowledge base elements
                anime({
                    targets: ".kb-config, .kb-documents",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });

                anime({
                    targets: ".document-list li",
                    opacity: [0, 1],
                    translateX: [20, 0],
                    delay: anime.stagger(200, { start: 500 }),
                    duration: 600,
                });
                break;

            case "part1-scene4":
                // Animate evaluation metrics
                anime({
                    targets: ".evaluation-setup, .evaluation-metrics",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });

                anime({
                    targets: ".metric-bar .claude-bar, .metric-bar .nova-bar",
                    width: [0, (el: HTMLElement) => el.dataset.width || "90%"],
                    delay: anime.stagger(200, { start: 500 }),
                    duration: 1000,
                    easing: "easeOutElastic(1, .5)",
                });
                break;

            case "part2-scene1":
                // Animate agent creation elements
                anime({
                    targets: ".agent-config, .agent-kb-connection, .agent-test",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });
                break;

            case "part2-scene2":
                // Animate web integration elements
                anime({
                    targets: ".app-mockup",
                    opacity: [0, 1],
                    scale: [0.95, 1],
                    duration: 800,
                });

                anime({
                    targets: ".user-query, .processing-step, .agent-response",
                    opacity: [0, 1],
                    translateY: [10, 0],
                    delay: anime.stagger(300, { start: 400 }),
                    duration: 600,
                });
                break;

            case "part3-scene1":
                // Animate prompt caching elements
                anime({
                    targets: ".usage-analysis, .cache-setup",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });

                anime({
                    targets: ".usage-analysis li",
                    opacity: [0, 1],
                    translateX: [20, 0],
                    delay: anime.stagger(200, { start: 500 }),
                    duration: 600,
                });
                break;

            case "part3-scene2":
                // Animate prompt routing elements
                anime({
                    targets: ".routing-setup, .complexity-analysis",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });

                anime({
                    targets: ".rule",
                    opacity: [0, 1],
                    translateX: [20, 0],
                    delay: anime.stagger(300, { start: 500 }),
                    duration: 600,
                });
                break;

            case "part3-scene3":
                // Animate optimization testing elements
                anime({
                    targets: ".test-case",
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(300),
                    duration: 800,
                });

                anime({
                    targets: ".metric",
                    opacity: [0, 1],
                    translateX: [20, 0],
                    delay: anime.stagger(200, { start: 1000 }),
                    duration: 600,
                });
                break;

            default:
                break;
        }
    };

    // Update narrator text based on current step with animation
    const updateNarratorText = (stepId: string) => {
        const narratorTexts: Record<string, string> = {
            intro: "Welcome to the Amazon Bedrock All Up demo journey.",
            "part1-problem": "In this Journey, OkBank faced a critical customer service crisis.",
            "part1-scene1": "Let's explore the Amazon Bedrock Model Catalog.",
            "part1-scene2": "In the Bedrock Playground, we'll compare models.",
            "part1-scene3": "Now we need to establish a specialized knowledge base.",
            "part1-scene4": "Let's use Amazon Bedrock's Model Evaluation feature.",
            "part2-scene1": "Let's build our financial advisory application.",
            "part2-scene2": "Now we'll see our agent in action.",
            "part3-scene1": "Let's implement prompt caching to optimize response times.",
            "part3-scene2": "Now, let's set up prompt routing.",
            "part3-scene3": "Let's test our optimized system.",
        };

        setNarratorText(narratorTexts[stepId] || "");
    };

    return (
        <div className="bedrock-journey-container" ref={journeyContainerRef}>
            {/* Sidebar for journey type selection */}
            <Sidebar activeJourneyType={journeyType} onJourneyTypeChange={setJourneyType} />

            {journeyType === "standard" && (
                <>
                    {/* Narrator section */}
                    <div className="narrator">
                        <div className="narrator-avatar"></div>
                        <div className="narrator-speech">
                            <p>{narratorText}</p>
                        </div>
                    </div>

                    {/* Journey content */}
                    <div className="journey-content">
                        {/* Introduction */}
                        <section
                            className={`journey-section intro ${currentJourneyStep === 0 ? "active" : ""}`}
                        >
                            <h1 className="title">Amazon Bedrock All Up</h1>
                            <p className="subtitle">
                                A journey-based demonstration of Amazon Bedrock features
                            </p>
                            <div className="intro-description">
                                <p>
                                    Amazon Bedrock All Up demo is a journey-based demonstration
                                    where customers can easily understand how Amazon Bedrock
                                    features can be used in their Generative AI application journey.
                                </p>
                                <p>
                                    Customers will learn through story-based journeys and customer
                                    use case examples, seeing how personas applied specific features
                                    or combinations of features to solve particular business
                                    problems.
                                </p>
                            </div>
                        </section>

                        {/* Part 1: Problem Statement */}
                        <section
                            className={`journey-section part1-problem ${currentJourneyStep === 1 ? "active" : ""}`}
                        >
                            <h2>Journey 1 - OkBank's Customer Service Transformation</h2>
                            <div className="problem-statement">
                                <h3>Problem Statement</h3>
                                <ul>
                                    <li>
                                        Customer inquiries increased 300% across multiple languages
                                        and time zones
                                    </li>
                                    <li>Response times jumped from 2 hours to over 12 hours</li>
                                    <li>Customer satisfaction plummeted from 4.6/5 to 3.2/5</li>
                                    <li>Support team turnover reached 35% in just one quarter</li>
                                </ul>
                            </div>
                            <div className="sarah-profile">
                                <div className="profile-image"></div>
                                <div className="profile-info">
                                    <h4>Sarah Chen</h4>
                                    <p>VP of Customer Experience</p>
                                    <p>
                                        Had 90 days to transform support operations or scale back
                                        global expansion
                                    </p>
                                </div>
                            </div>
                        </section>

                        {/* Part 1: Scene 1 - Model Catalog */}
                        <section
                            className={`journey-section part1-scene1 ${currentJourneyStep === 2 ? "active" : ""}`}
                        >
                            <h3>Part 1: Model Selection with Amazon Bedrock</h3>
                            <h4>Scene 1: Exploring the Model Catalog</h4>

                            <div className="console-view">
                                <div className="console-header">
                                    Amazon Bedrock Console - Model Catalog
                                </div>
                                <div className="model-selection">
                                    <div className="model-card claude">
                                        <h4>Claude 3.5 Sonnet</h4>
                                        <div className="model-details">
                                            <p>
                                                Excellent for understanding nuanced customer queries
                                            </p>
                                            <ul>
                                                <li>Advanced natural language understanding</li>
                                                <li>Strong contextual comprehension</li>
                                                <li>Multilingual support</li>
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="model-card nova">
                                        <h4>Amazon Nova Pro</h4>
                                        <div className="model-details">
                                            <p>Excels in technical problem-solving</p>
                                            <ul>
                                                <li>Optimized for financial calculations</li>
                                                <li>Regulatory compliance expertise</li>
                                                <li>Efficient response generation</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Part 1: Scene 2 - Playground Comparison */}
                        <section
                            className={`journey-section part1-scene2 ${currentJourneyStep === 3 ? "active" : ""}`}
                        >
                            <h4>Scene 2: Playground Model Comparison</h4>

                            <div className="playground-comparison">
                                <div className="playground-prompt">
                                    <h5>Test Prompt:</h5>
                                    <div className="prompt-text">
                                        <p>You are a financial advisor in Australia.</p>
                                        <p>
                                            Please explain the tax implications when buying and
                                            selling shares on the ASX,
                                        </p>
                                        <p>
                                            including how capital gains are calculated, the impact
                                            of holding periods,
                                        </p>
                                        <p>and the treatment of dividends and losses.</p>
                                    </div>
                                </div>

                                <div className="model-responses">
                                    <div className="model-response claude">
                                        <h5>Claude 3.5 Sonnet Response:</h5>
                                        <div className="response-content">
                                            <p>Provides detailed payment breakdown</p>
                                            <p>Explains financial concepts clearly</p>
                                            <p>Includes considerations for decision-making</p>
                                        </div>
                                    </div>

                                    <div className="model-response nova">
                                        <h5>Amazon Nova Pro Response:</h5>
                                        <div className="response-content">
                                            <p>Delivers precise calculations</p>
                                            <p>Focuses on numerical accuracy</p>
                                            <p>Presents comparative scenarios</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Part 1: Scene 3 - Knowledge Base */}
                        <section
                            className={`journey-section part1-scene3 ${currentJourneyStep === 4 ? "active" : ""}`}
                        >
                            <h4>Scene 3: Creating a Financial Services Knowledge Base</h4>

                            <div className="knowledge-base-creation">
                                <div className="kb-config">
                                    <h5>Knowledge Base Configuration:</h5>
                                    <div className="config-details">
                                        <p>
                                            <strong>Name:</strong> AUS-Financial-Regulations-KB
                                        </p>
                                        <p>
                                            <strong>Description:</strong> Australian financial
                                            regulations, tax codes, and ASX requirements
                                        </p>
                                        <p>
                                            <strong>Vector Store:</strong> Amazon Titan Embedding
                                        </p>
                                    </div>
                                </div>

                                <div className="kb-documents">
                                    <h5>Uploaded Documents:</h5>
                                    <ul className="document-list">
                                        <li>Internal ASX trading procedure manuals</li>
                                        <li>ATO tax guidelines and interpretations</li>
                                        <li>Company-specific compliance documentation</li>
                                        <li>Historical customer query resolutions</li>
                                    </ul>
                                </div>
                            </div>
                        </section>

                        {/* Part 1: Scene 4 - Model Evaluation */}
                        <section
                            className={`journey-section part1-scene4 ${currentJourneyStep === 5 ? "active" : ""}`}
                        >
                            <h4>Scene 4: Setting Up RAG Model Evaluation</h4>

                            <div className="model-evaluation">
                                <div className="evaluation-setup">
                                    <h5>Evaluation Configuration:</h5>
                                    <ul>
                                        <li>Automated reasoning metrics</li>
                                        <li>
                                            Ground truth dataset from verified customer interactions
                                        </li>
                                        <li>Response accuracy thresholds</li>
                                        <li>
                                            Model-as-judge evaluation using Claude as reference
                                            model
                                        </li>
                                    </ul>
                                </div>

                                <div className="evaluation-metrics">
                                    <h5>Evaluation Metrics:</h5>
                                    <div className="metrics-comparison">
                                        <div className="metric">
                                            <span className="metric-name">Response Accuracy</span>
                                            <div className="metric-bar">
                                                <div className="claude-bar" data-width="92%">
                                                    92%
                                                </div>
                                                <div className="nova-bar" data-width="90%">
                                                    90%
                                                </div>
                                            </div>
                                        </div>

                                        <div className="metric">
                                            <span className="metric-name">Source Attribution</span>
                                            <div className="metric-bar">
                                                <div className="claude-bar" data-width="88%">
                                                    88%
                                                </div>
                                                <div className="nova-bar" data-width="91%">
                                                    91%
                                                </div>
                                            </div>
                                        </div>

                                        <div className="metric">
                                            <span className="metric-name">
                                                Regulatory Compliance
                                            </span>
                                            <div className="metric-bar">
                                                <div className="claude-bar" data-width="95%">
                                                    95%
                                                </div>
                                                <div className="nova-bar" data-width="94%">
                                                    94%
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="evaluation-conclusion">
                                        <p>
                                            In this specific case Amazon Nova Pro has performed just
                                            as good as Claude Sonnet, so we will move onto
                                            Development using Nova.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Part 2: Scene 1 - Creating the Agent */}
                        <section
                            className={`journey-section part2-scene1 ${currentJourneyStep === 6 ? "active" : ""}`}
                        >
                            <h3>Part 2: Building the App</h3>
                            <h4>Scene 1: Creating the Bedrock Agent</h4>

                            <div className="agent-creation">
                                <div className="agent-config">
                                    <h5>Agent Configuration:</h5>
                                    <div className="config-details">
                                        <p>
                                            <strong>Name:</strong> AUSFinanceAgent
                                        </p>
                                        <p>
                                            <strong>Model:</strong> Nova Pro
                                        </p>
                                        <p>
                                            <strong>Description:</strong> Financial advisory agent
                                            for Australian market regulations
                                        </p>
                                    </div>
                                </div>

                                <div className="agent-kb-connection">
                                    <h5>Knowledge Base Connection:</h5>
                                    <p>Connected to: AUS-Financial-Regulations-KB</p>
                                </div>

                                <div className="agent-test">
                                    <h5>Test Query:</h5>
                                    <div className="test-query">
                                        How do ASX trading regulations affect international
                                        investors?
                                    </div>
                                    <div className="test-response">
                                        <p>
                                            International investors trading on the ASX must comply
                                            with Australia's foreign investment regulations...
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Part 2: Scene 2 - Web Integration */}
                        <section
                            className={`journey-section part2-scene2 ${currentJourneyStep === 7 ? "active" : ""}`}
                        >
                            <h4>Scene 2: Web Application Integration and Flow</h4>

                            <div className="web-integration">
                                <div className="app-mockup">
                                    <div className="app-header">OkBank Financial Assistant</div>
                                    <div className="chat-flow">
                                        <div className="user-query">
                                            How do I report my ASX share trading profits?
                                        </div>
                                        <div className="system-processing">
                                            <div className="processing-step">
                                                1. Agent receives query
                                            </div>
                                            <div className="processing-step">
                                                2. Knowledge base activates
                                            </div>
                                            <div className="processing-step">
                                                3. RAG processing begins
                                            </div>
                                            <div className="processing-step">
                                                4. Response generation starts
                                            </div>
                                        </div>
                                        <div className="agent-response">
                                            <p>
                                                To report your ASX share trading profits in
                                                Australia, you'll need to:
                                            </p>
                                            <ol>
                                                <li>
                                                    Calculate your capital gains for each share sale
                                                </li>
                                                <li>
                                                    Apply the appropriate CGT discount if shares
                                                    were held for &gt;12 months
                                                </li>
                                                <li>
                                                    Complete the Capital Gains section in your tax
                                                    return
                                                </li>
                                                <li>
                                                    Attach detailed records of your calculations
                                                </li>
                                            </ol>
                                            <p>
                                                For more information, refer to the ATO's guide on
                                                reporting share income.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Part 3: Scene 1 - Prompt Caching */}
                        <section
                            className={`journey-section part3-scene1 ${currentJourneyStep === 8 ? "active" : ""}`}
                        >
                            <h3>Part 3: Optimizing</h3>
                            <h4>Scene 1: Analyzing Usage Data and Implementing Prompt Caching</h4>

                            <div className="prompt-caching">
                                <div className="usage-analysis">
                                    <h5>Usage Analysis Findings:</h5>
                                    <ul>
                                        <li>60% of queries are repetitive across customers</li>
                                        <li>75% of questions are simple informational requests</li>
                                        <li>Peak usage times create response delays</li>
                                    </ul>
                                </div>

                                <div className="cache-setup">
                                    <h5>Prompt Caching Configuration:</h5>
                                    <div className="console-view">
                                        <div className="console-header">
                                            Amazon Bedrock Console - Prompt Caching
                                        </div>
                                        <div className="cache-settings">
                                            <p>
                                                <strong>Cache TTL:</strong> 24 hours
                                            </p>
                                            <p>
                                                <strong>Cache Size:</strong> 500 entries
                                            </p>
                                            <p>
                                                <strong>Match Threshold:</strong> 90% similarity
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Part 3: Scene 2 - Prompt Routing */}
                        <section
                            className={`journey-section part3-scene2 ${currentJourneyStep === 9 ? "active" : ""}`}
                        >
                            <h4>Scene 2: Implementing Prompt Routing</h4>

                            <div className="prompt-routing">
                                <div className="routing-setup">
                                    <h5>Routing Configuration:</h5>
                                    <div className="routing-rules">
                                        <div className="rule">
                                            <div className="rule-condition">
                                                Simple queries (informational, factual)
                                            </div>
                                            <div className="rule-arrow">→</div>
                                            <div className="rule-target">Amazon Nova Lite</div>
                                        </div>
                                        <div className="rule">
                                            <div className="rule-condition">
                                                Complex regulatory questions
                                            </div>
                                            <div className="rule-arrow">→</div>
                                            <div className="rule-target">Amazon Nova Pro</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="complexity-analysis">
                                    <h5>Query Complexity Analysis:</h5>
                                    <p>Queries are analyzed for:</p>
                                    <ul>
                                        <li>Sentence structure complexity</li>
                                        <li>Domain-specific terminology</li>
                                        <li>Multi-part questions</li>
                                        <li>Regulatory references</li>
                                    </ul>
                                </div>
                            </div>
                        </section>

                        {/* Part 3: Scene 3 - Testing Optimizations */}
                        <section
                            className={`journey-section part3-scene3 ${currentJourneyStep === 10 ? "active" : ""}`}
                        >
                            <h4>Scene 3: Testing Optimized Application</h4>

                            <div className="optimization-testing">
                                <div className="test-queries">
                                    <div className="test-case">
                                        <h5>Simple Query Test:</h5>
                                        <div className="query">
                                            "What are trading hours for the ASX?"
                                        </div>
                                        <div className="optimization-highlight">
                                            <span className="optimization-tag cache">
                                                Served from Cache
                                            </span>
                                            <span className="response-time">
                                                Response time: 120ms
                                            </span>
                                        </div>
                                    </div>

                                    <div className="test-case">
                                        <h5>Complex Query Test:</h5>
                                        <div className="query">
                                            "How do international tax treaties affect my ASX
                                            investments?"
                                        </div>
                                        <div className="optimization-highlight">
                                            <span className="optimization-tag routing">
                                                Routed to Nova Pro
                                            </span>
                                            <span className="response-time">
                                                Response time: 1.2s
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="performance-metrics">
                                    <h5>Performance Improvements:</h5>
                                    <div className="metric">
                                        <span className="metric-name">Response Time</span>
                                        <div className="metric-improvement">
                                            70% faster for common queries
                                        </div>
                                    </div>
                                    <div className="metric">
                                        <span className="metric-name">Cost Reduction</span>
                                        <div className="metric-improvement">
                                            40% overall cost reduction
                                        </div>
                                    </div>
                                    <div className="metric">
                                        <span className="metric-name">Accuracy</span>
                                        <div className="metric-improvement">
                                            Maintained at 94%+ levels
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* Navigation controls */}
                    <div className="journey-controls">
                        <div className="progress-indicator">
                            <div
                                className="progress-indicator-bar"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>

                        <button
                            className="control-button prev"
                            onClick={() => navigateJourney("prev")}
                            disabled={currentJourneyStep === 0 || isTransitioning}
                        >
                            Previous
                        </button>

                        <div className="journey-progress">
                            {journeySteps.map((step, index) => (
                                <div
                                    key={step.id}
                                    className={`progress-dot ${index === currentJourneyStep ? "active" : ""}`}
                                    title={step.title}
                                    onClick={() => {
                                        if (!isTransitioning) {
                                            navigateToStep(index);
                                        }
                                    }}
                                ></div>
                            ))}
                        </div>

                        {showNextButton && (
                            <button
                                className="control-button next"
                                onClick={() => navigateJourney("next")}
                                disabled={isTransitioning}
                            >
                                Next
                            </button>
                        )}

                        {!showNextButton && currentJourneyStep === 5 && (
                            <button
                                className="control-button part"
                                onClick={() => navigateToStep(6)}
                                disabled={isTransitioning}
                            >
                                Start Part 2: Building the App
                            </button>
                        )}

                        {!showNextButton && currentJourneyStep === 7 && (
                            <button
                                className="control-button part"
                                onClick={() => navigateToStep(8)}
                                disabled={isTransitioning}
                            >
                                Start Part 3: Optimizing
                            </button>
                        )}
                    </div>
                </>
            )}

            {journeyType === "scroll" && <ScrollJourney journeySteps={journeySteps} />}

            {journeyType === "timeline" && <TimelineJourney journeySteps={journeySteps} />}
        </div>
    );
};

export default Chat;
