import React, { useContext, useState, useMemo } from 'react'
import PropTypes from 'prop-types'
import {fetchUserAttributes} from "aws-amplify/auth";
import { useApplySiteSettings } from '../hooks/useSiteApplySettings'


interface Identity {
  dateCreated: string;
  userId: string;
  providerName: string;
  providerType: string;
  issuer: string | null;
  primary: string;
}

interface UserDetails {
  email: string;
  email_verified: string;
  name: string;
  family_name: string;
  given_name: string;
  "custom:country": string;
  "custom:alias": string;
  "custom:business_unit": string;
  "custom:job_code": string;
  sub: string;
  identities: Identity[];
}

export interface NotificationItem {
  header?: string;
  content: string;
  type?: string;
  dismissible?: boolean;
  id?: string,
  onDismiss?: () => void
}

const AppStateContext = React.createContext({
  notificationItem: {header:'', content:'', type:'', dismissible:true, id:'', onDismiss:()=>{}},
  pushNotification: (header:any, content:any, type:any, dismissible:any) => {},
  pushNotificationItem: (item:NotificationItem) => {},
  userDetails: {} as UserDetails,
  setUserDetails: (user:any) => {},
  demoName: '',
  isNavigationOpen: false,
  setIsNavigationOpen: (flag:boolean) => {},
  activeHref: '/',
  darkMode: false,
  toggleDarkMode: () => {}
})

export function useAppState() {
  const state = useContext(AppStateContext)

  if (!state) {
    throw new Error('useAppState must be used within AppStateProvider')
  }

  return state
}
AppStateProvider.propTypes = {
  demoIdentifier: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired
}
export function AppStateProvider({ demoIdentifier, children }: any) {
  const [notificationItem, setNotificationItem] = useState({} as NotificationItem)
  const [userDetails, setUserDetails] = useState({} as UserDetails)
  const [demoName] = useState(demoIdentifier)
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [activeHref, setActiveHref] = useState('#/page1')
  const [darkMode, toggleDarkMode] = useApplySiteSettings()
  const [filteringOptions, setFilteringOptions] = useState([])
  const [allDemos, setAllDemos] = useState([])

  const pushNotificationItem = (item:NotificationItem) => {
    setNotificationItem(item)
  }

  const populateUser = async () => {
    const userAttributes = await fetchUserAttributes();
    console.log(userAttributes)
  }

  /**
   *
   * @param header Specifies the heading text.
   * @param content Specifies the primary text displayed in the flash element.
   * @param type Indicates the type of the message to be displayed. Allowed values are as follows: success, error, warning, info. The default is info.
   * @param dismissible Determines whether the component includes a close button icon. The default is true.
   */
  const pushNotification = (header:string, content:string, type = 'info', dismissible = true) => {
    setNotificationItem({header, content, type, dismissible})
  }

  const providerValue = useMemo(() => ({
    allDemos,
    setAllDemos,
    demoName,
    notificationItem,
    pushNotification,
    pushNotificationItem,
    userDetails,
    setUserDetails,
    isNavigationOpen,
    setIsNavigationOpen,
    activeHref,
    setActiveHref,
    darkMode,
    toggleDarkMode,
    filteringOptions,
    setFilteringOptions
  }), [
    allDemos,
    setAllDemos,
    demoName,
    notificationItem,
    pushNotification,
    pushNotificationItem,
    userDetails,
    setUserDetails,
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
    //@ts-ignore
    <AppStateContext.Provider value={providerValue}>
      {children}
    </AppStateContext.Provider>
  )
}
