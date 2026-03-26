import { createContext, useContext, useReducer, PropsWithChildren } from "react";

export interface MenuItem {
    id: string;
    name: string;
    description: string;
    price: string;
    category: string;
    dietary?: string[];
    imageUrl?: string;
}

export interface MenuSection {
    category: string;
    items: MenuItem[];
}

export interface MenuState {
    sections: MenuSection[];
    isGenerating: boolean;
    pdfUrl: string | null;
}

type MenuAction =
    | { type: "SET_SECTIONS"; sections: MenuSection[] }
    | { type: "ADD_ITEM"; item: MenuItem }
    | { type: "UPDATE_ITEM"; id: string; updates: Partial<MenuItem> }
    | { type: "REMOVE_ITEM"; id: string }
    | { type: "SET_PDF_URL"; url: string | null }
    | { type: "SET_GENERATING"; isGenerating: boolean }
    | { type: "SET_LAST_ITEM_IMAGE"; imageUrl: string }
    | { type: "RESET" };

const initialState: MenuState = {
    sections: [],
    isGenerating: false,
    pdfUrl: null,
};

function menuReducer(state: MenuState, action: MenuAction): MenuState {
    switch (action.type) {
        case "SET_SECTIONS":
            return { ...state, sections: action.sections };

        case "ADD_ITEM": {
            const existing = state.sections.find((s) => s.category === action.item.category);
            if (existing) {
                return {
                    ...state,
                    sections: state.sections.map((s) =>
                        s.category === action.item.category
                            ? { ...s, items: [...s.items, action.item] }
                            : s
                    ),
                };
            }
            return {
                ...state,
                sections: [
                    ...state.sections,
                    { category: action.item.category, items: [action.item] },
                ],
            };
        }

        case "UPDATE_ITEM":
            return {
                ...state,
                sections: state.sections.map((s) => ({
                    ...s,
                    items: s.items.map((item) =>
                        item.id === action.id ? { ...item, ...action.updates } : item
                    ),
                })),
            };

        case "REMOVE_ITEM":
            return {
                ...state,
                sections: state.sections
                    .map((s) => ({
                        ...s,
                        items: s.items.filter((item) => item.id !== action.id),
                    }))
                    .filter((s) => s.items.length > 0),
            };

        case "SET_PDF_URL":
            return { ...state, pdfUrl: action.url };

        case "SET_GENERATING":
            return { ...state, isGenerating: action.isGenerating };

        case "SET_LAST_ITEM_IMAGE": {
            // Find the last item across all sections that has no imageUrl and set it
            const sections = [...state.sections].map((s) => ({ ...s, items: [...s.items] }));
            let found = false;
            for (let si = sections.length - 1; si >= 0 && !found; si--) {
                for (let ii = sections[si].items.length - 1; ii >= 0 && !found; ii--) {
                    if (!sections[si].items[ii].imageUrl) {
                        sections[si].items[ii] = {
                            ...sections[si].items[ii],
                            imageUrl: action.imageUrl,
                        };
                        found = true;
                    }
                }
            }
            return found ? { ...state, sections } : state;
        }

        case "RESET":
            return initialState;

        default:
            return state;
    }
}

interface MenuContextType {
    state: MenuState;
    dispatch: React.Dispatch<MenuAction>;
}

const MenuContext = createContext<MenuContextType | undefined>(undefined);

export function useMenu(): MenuContextType {
    const context = useContext(MenuContext);
    if (context === undefined) {
        throw new Error("useMenu must be used within a MenuContextProvider");
    }
    return context;
}

export function MenuContextProvider({ children }: PropsWithChildren): JSX.Element {
    const [state, dispatch] = useReducer(menuReducer, initialState);

    return <MenuContext.Provider value={{ state, dispatch }}>{children}</MenuContext.Provider>;
}
