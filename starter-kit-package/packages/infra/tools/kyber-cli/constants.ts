export interface OperationProps {
    opr: string
}


export enum MainOperationEnum {
    REFRESH_CREDS = "Refresh Credentials 🔑",
    SYNTH_INFRA = "Synthesize CDK Infra 🧪",
    DEPLOY_INFRA = "Deploy Infra 🚂",
    DEPLOY_WEBAPP = "Deploy Webapp 🌐",
    DEPLOY_ALL = "Deploy Infra + Webapp 💯",
    SERVE_WEBAPP = "Serve Local Webapp 🖥️",
    HYDRATE = "Hydrate 🧼",
    REFRESH_LOCAL_ENV = "Refresh Webapp Env 📦",
    DELETE_CDK_STACK = "Delete CDK stack 🗑️",
    EXIT = "Exit 👋"
}