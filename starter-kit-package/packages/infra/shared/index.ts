export enum PresetStageType {
    Dev = "dev",
    Prod = "prod"
}

export type AccountType = {
    number: string;
    region: string;
    midwaySecretID?: string;
}

export type SelectPresetStageType = {
    stage: string
}

export type AccountObjectType = {
    [key: string]: AccountType;
}


export interface SandboxAccountType extends AccountType {
    alias: string;
}

export type ProjectConfigType = {
    projectName: string;
    gitlabGroup: string
    gitlabProject: string
    codeArtifact: boolean
    codePipeline: boolean
    midway: boolean
    account: AccountObjectType;
}