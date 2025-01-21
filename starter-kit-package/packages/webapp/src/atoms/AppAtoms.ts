import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { Mode } from '@cloudscape-design/global-styles';
import { FetchUserAttributesOutput } from 'aws-amplify/auth';
import { AuthedUserType } from "../utils/types";

// 
export const appName = "Demo Starter Kit"
// Theme atom
export const themeAtom = atomWithStorage<Mode>('theme', Mode.Light);

export const toggleThemeAtom = atom(null, (get, set) => set(themeAtom, get(themeAtom) === Mode.Light ? Mode.Dark : Mode.Light));
export const UserAttributesAtom = atom<FetchUserAttributesOutput | null>(null);

// left side nav drawer
export const navDrawerAtom = atom(true);
// right side info panel drawer
export const infoDrawerAtom = atom(false);
export const openInfoDrawerAtom = atom(null, (get, set) =>
    set(infoDrawerAtom, true));
export const closeInfoDrawerAtom = atom(null, (get, set) =>
    set(infoDrawerAtom, false));
export const toggleInfoDrawerAtom = atom(null, (get, set) =>
    set(infoDrawerAtom, !get(infoDrawerAtom)));

export enum HelpPanelTitle {
    EMPTY = "EMPTY"
}
export const infoIdAtom = atom<HelpPanelTitle>(HelpPanelTitle.EMPTY);

export const splitPanelAtom = atom(false);
export const showSplitPanelAtom = atom(null, (get, set) =>
    set(splitPanelAtom, true));

export const authedUserAtom = atom<AuthedUserType | null>(null)