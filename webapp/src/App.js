import React, { useState, useEffect } from 'react'
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  useNavigate
} from 'react-router-dom'
import '@cloudscape-design/global-styles/index.css'
import {
  AppLayout,
  SideNavigation,
  TopNavigation,
} from '@cloudscape-design/components'
import RenderError from './components/RenderError'
import Notifications from './components/Notifications'
import { LandingPage } from './components/LandingPage'
import logo from './images/AWS_logo_RGB_WHT.png'
import { useAppState } from './providers/AppStateProvider'
import { getAuthentication, signOut } from './auth'
import { Amplify } from '@aws-amplify/core'
import '@aws-amplify/ui-react/styles.css'
import LoginPrompt from './components/auth/LoginPrompt'

const logger = new Amplify.Logger('GenAILabsDemo')
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppContainerLayout />,
    errorElement: <RenderError />,
    children: [
      {
        path: '/',
        element: <LandingPage />
      },
    ]
  }
])

function App() {

  const { pushNotification } = useAppState()

  const { user, setUser } = useAppState()
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  // configure user effect at login
  useEffect(() => {
    const fetchAuthInfo = async () => {
      try {
        const authenticationInfo = await getAuthentication()
        setUser(authenticationInfo)
        setIsAuthenticated(true)
      } catch (error) {
        console.error('Error fetching authentication info:', error)
        pushNotification('There was an error retrieving authentication info', '', 'error', true)
        setIsAuthenticated(false)
      }
    }
    fetchAuthInfo()
  }, [])
  if (isAuthenticated) {
    // User is authenticated, tokens are valid.
    logger.info('User is ', user)
    return <RouterProvider router={router} />
  }
  else {
    return <LoginPrompt />
  }
}
function AppContainerLayout() {
  const {
    user,
    isNavigationOpen,
    setIsNavigationOpen,
    activeHref, darkMode,
    toggleDarkMode
  } = useAppState()

  // Set side navigation bar open on first load
  useEffect(() => {
    setIsNavigationOpen(true)
  }, [])

  // Fetch and set demos on first load
  useEffect(() => {
    // Add any API calls here
  }, [])

  const navigate = useNavigate()

  function followLink(e) {
    e.preventDefault()
    const { href } = e.detail
    if (href.startsWith('http') || href.startsWith('mailto:')) {
      window.open(href, '_blank')
    } else {
      console.log('Link clicked: ', href)
      navigate(href)
    }
  }

  return (
    <>
      <TopNavigation
        identity={
          {
            href: '/', title: '', logo: {
              src: logo, alt: 'AWS logo'
            }
          }
        }
        utilities={[
          {
            type: 'button',
            variant: 'primary-button',
            onClick: () => toggleDarkMode(),
            text: darkMode ? '☀️' : '🌙',
          },
          {
            type: 'menu-dropdown',
            text: user?.name,
            description: user?.email,
            iconName: 'user-profile',
            onItemClick: (event) => event.detail.id === 'signout' && signOut(),
            items: [
              { id: 'signout', text: 'Sign out' }]
          }]}
      />
      <AppLayout
        toolsHideOnScroll={false}
        navigationOpen={isNavigationOpen}
        onNavigationChange={(event) => setIsNavigationOpen(event.detail.open)}
        navigation={
          <SideNavigation
            activeHref={activeHref}
            header={{ href: '/', text: '<Gen AI Labs Demo Name>' }}
            onFollow={followLink}
            items={[
              { type: 'link', text: 'Home', href: '/' },
              {
                type: 'section', text: 'Placeholder', items: [
                  {
                    type: 'link', text: 'Placeholder 1', href: '/placeholder1'
                  },
                  {
                    type: 'link', text: 'Placeholder 2', href: '/placeholder2'
                  },
                  {
                    type: 'link', text: 'Placeholder 3', href: '/placeholder3'
                  }
                ]
              },
              { type: 'divider' },
              {
                type: 'link', text: 'Documentation', href: 'https://w.amazon.com/bin/view/Internal-GenAI-Labs/demo-lifecycle/HowTo/', external: true
              },
              {
                type: 'section', text: 'Reach out to us', items: [
                  {
                    type: 'link',
                    text: 'Email',
                    href: 'mailto:aws-genai-labs-demo+support@amazon.com',
                    external: true,
                    externalIconAriaLabel: 'Opens in a new tab'
                  }, {
                    type: 'link',
                    text: 'Ticket',
                    href: 'https://t.corp.amazon.com/create/options?category=AWS&group=WWSO+GenAI+Demo+Platform+Team&item=aws-genai-labs-demo&type=Generative+AI',
                    external: true,
                    externalIconAriaLabel: 'Opens in a new tab'
                  }, {
                    type: 'link',
                    text: 'Slack',
                    href: 'https://amazon.enterprise.slack.com/archives/C076P1WAC3F',
                    external: true,
                    externalIconAriaLabel: 'Opens in a new tab'
                  }, {
                    type: 'link',
                    text: 'Feedback',
                    href: 'mailto:aws-genai-labs-demo+issues@amazon.com',
                    external: true,
                    externalIconAriaLabel: 'Opens in a new tab'
                  },
                ]
              },
            ]}
          />}
        content={<Outlet />}
        notifications={<Notifications />}
      />
    </>
  )
}
export default App
