// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from '@aws-amplify/core'
import { AmplifyConfig as config } from './auth'
import { AppConfigProvider } from './providers/AppConfigProvider'
import { AppStateProvider } from './providers/AppStateProvider'
import App from './App'
import './index.css'

// Configure AWS Amplify for authentication
Amplify.configure(config)
Amplify.Logger.LOG_LEVEL = 'DEBUG'

const container = document.getElementById('root')
const root = createRoot(container) // createRoot(container!) if you use TypeScript

// Access frontend configuration stored in root (index.html loads frontend-config.js)
const demoConfig = window.frontendConfig

root.render(
  <React.StrictMode>
    <AppConfigProvider demoConfig={demoConfig}>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </AppConfigProvider>
  </React.StrictMode>,
)
