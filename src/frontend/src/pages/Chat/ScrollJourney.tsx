import React, { useEffect, useRef, useState } from "react";
import anime from "animejs";
import { onScroll } from "../../utils/animeScroll";
import "./ScrollJourney.css";

interface ScrollJourneyProps {
    journeySteps: Array<{ id: string; title: string }>;
}

const ScrollJourney: React.FC<ScrollJourneyProps> = ({ journeySteps }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);
    const [activeSection, setActiveSection] = useState(0);
    const [scrollY, setScrollY] = useState(0);
    const debug = false;

    // Initialize section refs
    useEffect(() => {
        sectionRefs.current = Array(journeySteps.length).fill(null);
    }, [journeySteps.length]);

    // Handle scroll events
    useEffect(() => {
        const handleScroll = () => {
            if (!containerRef.current) return;

            const scrollPosition = containerRef.current.scrollTop;
            setScrollY(scrollPosition);

            // Determine which section is currently in view
            const currentSection = sectionRefs.current.findIndex((section) => {
                if (!section) return false;

                const rect = section.getBoundingClientRect();
                const sectionTop = rect.top;
                const sectionHeight = rect.height;

                // Section is considered active when its top is near the viewport top
                return sectionTop <= 100 && sectionTop > -sectionHeight + 200;
            });

            if (currentSection !== -1 && currentSection !== activeSection) {
                setActiveSection(currentSection);

                // Make sure the section content is visible
                const section = sectionRefs.current[currentSection];
                if (section) {
                    const content = section.querySelector(".scroll-content");
                    if (content) {
                        content.classList.add("visible");
                    }
                }
            }
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener("scroll", handleScroll);
        }

        return () => {
            if (container) {
                container.removeEventListener("scroll", handleScroll);
            }
        };
    }, [activeSection]);

    // Set up scroll-based animations
    useEffect(() => {
        if (!containerRef.current) return;

        // Make sure all sections are visible initially
        sectionRefs.current.forEach((section) => {
            if (section) {
                const content = section.querySelector(".scroll-content");
                if (content) {
                    content.classList.add("visible");
                }
            }
        });

        journeySteps.forEach((step, index) => {
            const section = sectionRefs.current[index];
            if (!section) return;

            // Set up animations based on scroll position
            const setupScrollAnimation = () => {
                const contentElements = section.querySelectorAll(".scroll-content");

                contentElements.forEach((content) => {
                    // Create animation for each content element
                    anime({
                        targets: content,
                        opacity: [0, 1],
                        translateY: [50, 0],
                        duration: 800,
                        easing: "easeOutQuad",
                        autoplay: onScroll({
                            container: containerRef.current,
                            target: content as HTMLElement,
                            debug: debug,
                        }),
                    });
                });

                // Animate specific elements based on step ID
                switch (step.id) {
                    case "intro":
                        anime({
                            targets: section.querySelectorAll(".title, .subtitle"),
                            opacity: [0, 1],
                            translateY: [20, 0],
                            delay: anime.stagger(200),
                            duration: 800,
                            easing: "easeOutQuad",
                            autoplay: onScroll({
                                container: containerRef.current,
                                target: section,
                                debug: debug,
                            }),
                        });

                        anime({
                            targets: section.querySelectorAll(".intro-description p"),
                            opacity: [0, 1],
                            translateY: [20, 0],
                            delay: anime.stagger(300, { start: 400 }),
                            duration: 800,
                            easing: "easeOutQuad",
                            autoplay: onScroll({
                                container: containerRef.current,
                                target: section,
                                debug: debug,
                            }),
                        });
                        break;

                    case "part1-problem":
                        anime({
                            targets: section.querySelectorAll(".problem-statement li"),
                            opacity: [0, 1],
                            translateX: [20, 0],
                            delay: anime.stagger(200),
                            duration: 600,
                            easing: "easeOutQuad",
                            autoplay: onScroll({
                                container: containerRef.current,
                                target: section.querySelector(".problem-statement") as HTMLElement,
                                debug: debug,
                            }),
                        });

                        anime({
                            targets: section.querySelectorAll(".sarah-profile"),
                            opacity: [0, 1],
                            scale: [0.9, 1],
                            delay: 500,
                            duration: 800,
                            easing: "easeOutQuad",
                            autoplay: onScroll({
                                container: containerRef.current,
                                target: section.querySelector(".sarah-profile") as HTMLElement,
                                debug: debug,
                            }),
                        });
                        break;

                    // Add cases for other steps...
                    default:
                        // Default animation for any other sections
                        anime({
                            targets: section.querySelectorAll("h3, h4, p"),
                            opacity: [0, 1],
                            translateY: [20, 0],
                            delay: anime.stagger(200),
                            duration: 800,
                            easing: "easeOutQuad",
                            autoplay: onScroll({
                                container: containerRef.current,
                                target: section,
                                debug: debug,
                            }),
                        });
                        break;
                }
            };

            // Set up animations after a short delay to ensure DOM is ready
            setTimeout(setupScrollAnimation, 100);
        });
    }, [journeySteps, debug]);

    // Scroll to a specific section
    const scrollToSection = (index: number) => {
        if (sectionRefs.current[index]) {
            sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth" });
        }
    };

    return (
        <div className="scroll-journey-container" ref={containerRef}>
            {/* Scroll indicator dots */}
            <div className="scroll-indicator">
                {journeySteps.map((step, index) => (
                    <div
                        key={step.id}
                        className={`scroll-dot ${activeSection === index ? "active" : ""}`}
                        onClick={() => scrollToSection(index)}
                        title={step.title}
                    />
                ))}
            </div>

            {/* Journey sections */}
            {journeySteps.map((step, index) => (
                <div
                    key={step.id}
                    ref={(el) => (sectionRefs.current[index] = el)}
                    className={`scroll-section ${step.id}`}
                    id={`section-${step.id}`}
                >
                    <div className="scroll-content">
                        {/* Content will be the same as in the standard journey */}
                        {step.id === "intro" && (
                            <>
                                <h1 className="title">Amazon Bedrock All Up</h1>
                                <p className="subtitle">
                                    A journey-based demonstration of Amazon Bedrock features
                                </p>
                                <div className="intro-description">
                                    <p>
                                        Amazon Bedrock All Up demo is a journey-based demonstration
                                        where customers can easily understand how Amazon Bedrock
                                        features can be used in their Generative AI application
                                        journey.
                                    </p>
                                    <p>
                                        Customers will learn through story-based journeys and
                                        customer use case examples, seeing how personas applied
                                        specific features or combinations of features to solve
                                        particular business problems.
                                    </p>
                                </div>
                            </>
                        )}

                        {step.id === "part1-problem" && (
                            <>
                                <h2>Journey 1 - OkBank's Customer Service Transformation</h2>
                                <div className="problem-statement">
                                    <h3>Problem Statement</h3>
                                    <ul>
                                        <li>
                                            Customer inquiries increased 300% across multiple
                                            languages and time zones
                                        </li>
                                        <li>Response times jumped from 2 hours to over 12 hours</li>
                                        <li>Customer satisfaction plummeted from 4.6/5 to 3.2/5</li>
                                        <li>
                                            Support team turnover reached 35% in just one quarter
                                        </li>
                                    </ul>
                                </div>
                                <div className="sarah-profile">
                                    <div className="profile-image"></div>
                                    <div className="profile-info">
                                        <h4>Sarah Chen</h4>
                                        <p>VP of Customer Experience</p>
                                        <p>
                                            Had 90 days to transform support operations or scale
                                            back global expansion
                                        </p>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Add content for other steps based on their IDs */}
                        {step.id === "part1-scene1" && (
                            <>
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
                                                    Excellent for understanding nuanced customer
                                                    queries
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
                            </>
                        )}

                        {step.id === "part1-scene2" && (
                            <>
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
                                                including how capital gains are calculated, the
                                                impact of holding periods,
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
                            </>
                        )}

                        {step.id === "part1-scene3" && (
                            <>
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
                                                <strong>Vector Store:</strong> Amazon Titan
                                                Embedding
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
                            </>
                        )}

                        {step.id === "part1-scene4" && (
                            <>
                                <h4>Scene 4: Setting Up RAG Model Evaluation</h4>

                                <div className="model-evaluation">
                                    <div className="evaluation-setup">
                                        <h5>Evaluation Configuration:</h5>
                                        <ul>
                                            <li>Automated reasoning metrics</li>
                                            <li>
                                                Ground truth dataset from verified customer
                                                interactions
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
                                                <span className="metric-name">
                                                    Response Accuracy
                                                </span>
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
                                                <span className="metric-name">
                                                    Source Attribution
                                                </span>
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
                                                In this specific case Amazon Nova Pro has performed
                                                just as good as Claude Sonnet, so we will move onto
                                                Development using Nova.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {step.id === "part2-scene1" && (
                            <>
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
                                                <strong>Description:</strong> Financial advisory
                                                agent for Australian market regulations
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
                                                International investors trading on the ASX must
                                                comply with Australia's foreign investment
                                                regulations...
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {step.id === "part2-scene2" && (
                            <>
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
                                                        Calculate your capital gains for each share
                                                        sale
                                                    </li>
                                                    <li>
                                                        Apply the appropriate CGT discount if shares
                                                        were held for &gt;12 months
                                                    </li>
                                                    <li>
                                                        Complete the Capital Gains section in your
                                                        tax return
                                                    </li>
                                                    <li>
                                                        Attach detailed records of your calculations
                                                    </li>
                                                </ol>
                                                <p>
                                                    For more information, refer to the ATO's guide
                                                    on reporting share income.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {step.id === "part3-scene1" && (
                            <>
                                <h3>Part 3: Optimizing</h3>
                                <h4>
                                    Scene 1: Analyzing Usage Data and Implementing Prompt Caching
                                </h4>

                                <div className="prompt-caching">
                                    <div className="usage-analysis">
                                        <h5>Usage Analysis Findings:</h5>
                                        <ul>
                                            <li>60% of queries are repetitive across customers</li>
                                            <li>
                                                75% of questions are simple informational requests
                                            </li>
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
                            </>
                        )}

                        {step.id === "part3-scene2" && (
                            <>
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
                            </>
                        )}

                        {step.id === "part3-scene3" && (
                            <>
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
                            </>
                        )}

                        {index < journeySteps.length - 1 && (
                            <div className="scroll-prompt">
                                <span>Scroll down to continue</span>
                                <span className="scroll-prompt-arrow">↓</span>
                            </div>
                        )}
                    </div>
                </div>
            ))}

            {/* Debug info */}
            {debug && (
                <div className="debug-scroll-info">
                    Scroll position: {scrollY}px | Active section: {activeSection}
                </div>
            )}
        </div>
    );
};

export default ScrollJourney;
