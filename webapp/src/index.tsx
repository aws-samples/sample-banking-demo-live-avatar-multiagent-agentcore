// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import {Amplify, ResourcesConfig} from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import {AppConfigProvider} from "./providers/AppConfigProvider";
import {AppStateProvider} from "./providers/AppStateProvider";
import {AuthConfig} from "@aws-amplify/core/src/singleton/Auth/types";
import {APIConfig} from "@aws-amplify/core/src/singleton/API/types";



// @ts-ignore
const webAppConfig = window.frontendConfig
console.log('webApp', webAppConfig)
//TODO get these into the outputs
const identityProvider =  webAppConfig.identityProviderName || 'AmazonFederate'
const backendRegion = webAppConfig.backendRegion || 'us-east-1'



const authConfig: AuthConfig= {
  "Cognito" : {
    "userPoolClientId": `${webAppConfig.cognitoAppClientId}`,
    "userPoolId": `${webAppConfig.cognitoUserPoolId}`,
    "loginWith": {
      "oauth": {
        "domain": `${webAppConfig.cognitoDomainName}.auth.${backendRegion}.amazoncognito.com`,
        "scopes": ["openid", "profile", "aws.cognito.signin.user.admin"],
        "redirectSignIn": [`${window.location.protocol}//${window.location.host}`],
        "redirectSignOut": [`${window.location.protocol}//${window.location.host}/logout`],
        "responseType": "code",
        "providers": [{"custom": identityProvider}],
      }
    }
  }
}

const apiConfig: APIConfig = {
  "REST": {
    "dataAPI": {
      "endpoint": `${webAppConfig.backendAPIEndpoint}`,
      "region": `${webAppConfig.backendRegion}`,
    }
  }
}


const config: ResourcesConfig = {
  "Auth": authConfig,
  "API": apiConfig
}

//console.debug(config)

Amplify.configure(config);

const DEMO_NAME = 'Insurance'

const container = document.getElementById('root')
const root = createRoot(container!)

root.render(
  <React.StrictMode>
    <Authenticator.Provider>
      <AppConfigProvider webappConfig={webAppConfig}>
        <AppStateProvider demoIdentifier={DEMO_NAME}>
        <App />
      </AppStateProvider>
      </AppConfigProvider>
    </Authenticator.Provider>
  </React.StrictMode>,
)


