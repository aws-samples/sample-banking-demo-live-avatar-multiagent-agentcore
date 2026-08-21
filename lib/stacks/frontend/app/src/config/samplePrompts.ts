/**
 * Sample prompts per experience.
 *
 * The welcome screen shows these before the first message, but it disappears
 * once a conversation starts. The chat input's "Samples" picker uses the same
 * lists so a presenter can fire another test prompt at any point, in every
 * experience — no need to start a new chat to find the examples again.
 */

export interface SamplePrompt {
    label: string;
    question: string;
}

/** Keys map to the chat experiences that expose a sample picker. */
export type SamplePromptKey = "research" | "menu" | "chatbot" | "generic_research";

export const SAMPLE_PROMPTS: Record<SamplePromptKey, SamplePrompt[]> = {
    research: [
        {
            label: "TXSE bank strategy (full brief)",
            question:
                "I have opened a new bank near the Texas Stock Exchange (TXSE) in Dallas, Texas. Please help me design a strategy and theme to operate the bank, including but not limited to know your customer (KYC), opening checking and savings accounts, providing retirement and investment services. In addition to the TXSE, the bank will also use the NYSE, Nasdaq, and the major stock exchanges in Europe. The strategy must include the ability to detect fraudulent accounts and transactions. Build a business plan, recommend the operating model, provide the staff recruitment requirements including salary, marketing and promotional strategies. Provide one best option rather than multiple choices. Based on the options, help me also generate a FAQ document for the customer to understand the details of the bank and its various services.",
        },
        {
            label: "Fraud detection strategy",
            question:
                "Research a fraud detection strategy for a new bank operating across the TXSE, NYSE, Nasdaq and major European exchanges — cover account-opening fraud, transaction monitoring, and KYC controls.",
        },
        {
            label: "Retirement & investment services",
            question:
                "Research the market for retirement and investment services a new Dallas bank should offer — IRAs, managed portfolios, and private client wealth — and recommend one best operating model.",
        },
    ],
    menu: [
        {
            label: "Full catalog from strategy",
            question:
                "Using our Trinity Reserve strategy report, build the full client services catalog — everyday checking, high-yield savings, retirement, and managed investing — with an image for each product",
        },
    ],
    chatbot: [
        { label: "Services catalog", question: "What services do you have in your catalog?" },
        {
            label: "Compare accounts",
            question: "Compare Everyday Checking and High-Yield Savings",
        },
        { label: "Open an account", question: "I'd like to open a High-Yield Savings account" },
        { label: "KYC requirements", question: "What do I need to verify my identity (KYC)?" },
        { label: "Open an IRA", question: "How do I open a Roth IRA?" },
        { label: "Managed investing", question: "Tell me about Trinity Managed Portfolios" },
        {
            label: "Employee salary (blocked by guardrail)",
            question: "What is a bank teller's salary at Trinity Reserve?",
        },
        {
            label: "Off-topic (blocked by guardrail)",
            question: "Write me a poem about the weather in Paris",
        },
    ],
    generic_research: [
        {
            label: "Market opportunity scan",
            question:
                "Research the competitive landscape and identify the top opportunities for a new digital bank targeting small businesses near a major stock exchange.",
        },
    ],
};
