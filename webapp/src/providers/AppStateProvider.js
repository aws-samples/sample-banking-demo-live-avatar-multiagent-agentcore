// Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { useContext, useState, useMemo } from 'react'
import PropTypes from 'prop-types'
import { useApplySiteSettings } from '../hooks/useSiteApplySettings'


const AppStateContext = React.createContext(null)

export function useAppState() {
  const state = useContext(AppStateContext)
  
  if (!state) {
    throw new Error('useAppState must be used within AppStateProvider')
  }

  return state
}
AppStateProvider.propTypes = {
  children: PropTypes.node.isRequired
}
export function AppStateProvider({ children }) {
  const [user, setUser] = useState(null)
  const [allDemos, setAllDemos] = useState([])
  const [catalogDemos, setCatalogDemos] = useState([])
  const [catalogQuery, setCatalogQuery] = useState({ tokens: [], operation: 'and' })
  const [notificationItem, setNotificationItem] = useState({})
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [activeHref, setActiveHref] = useState('#/page1')
  const [darkMode, toggleDarkMode] = useApplySiteSettings()
  const [filteringOptions, setFilteringOptions] = useState([])

  const pushNotificationItem = (item) => {
    setNotificationItem(item)
  }

  /**
   *
   * @param header Specifies the heading text.
   * @param content Specifies the primary text displayed in the flash element.
   * @param type Indicates the type of the message to be displayed. Allowed values are as follows: success, error, warning, info. The default is info.
   * @param dismissible Determines whether the component includes a close button icon. The default is true.
   */
  const pushNotification = (header, content, type = 'info', dismissible = true) => {
    setNotificationItem({header, content, type, dismissible})
  }

  const providerValue = useMemo(() => ({
    user,
    setUser,
    allDemos, 
    setAllDemos,
    catalogDemos, 
    setCatalogDemos,
    catalogQuery, 
    setCatalogQuery,
    notificationItem,
    pushNotification,
    pushNotificationItem,
    isNavigationOpen,
    setIsNavigationOpen,
    activeHref,
    setActiveHref,
    darkMode,
    toggleDarkMode,
    filteringOptions,
    setFilteringOptions
  }), [
    user,
    setUser,
    allDemos,
    setAllDemos,
    catalogDemos,
    setCatalogDemos,
    catalogQuery,
    setCatalogQuery,
    notificationItem,
    pushNotification,
    pushNotificationItem,
    isNavigationOpen,
    setIsNavigationOpen,
    activeHref,
    setActiveHref,
    darkMode,
    toggleDarkMode,
    filteringOptions,
    setFilteringOptions
  ])

  return (
    <AppStateContext.Provider value={providerValue}>
      {children}
    </AppStateContext.Provider>
  )
}