import { useEffect, useState } from 'react'
import { applyMode, Mode } from '@cloudscape-design/global-styles'

const useLocalStorage = (key:string, initialValue:boolean) => {
  const [localStorageValue, setLocalStorageValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.error('Error reading localStorage:', error)
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(localStorageValue))
    } catch (error) {
      console.error('Error writing to localStorage:', error)
    }
  }, [key, localStorageValue])

  return [localStorageValue, setLocalStorageValue]
}

export const useApplySiteSettings = () => {
  const [darkMode, setDarkMode] = useLocalStorage('darkMode', false)

  useEffect(() => {
    applyMode(darkMode ? Mode.Dark : Mode.Light)
  }, [darkMode])

  const toggleDarkMode = () => {
    setDarkMode((prevMode:any) => !prevMode)
  }

  return [darkMode, toggleDarkMode]
}