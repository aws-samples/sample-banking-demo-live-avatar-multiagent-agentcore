import { useNavigate } from 'react-router-dom'

export function useOnFollow() {
  const navigate = useNavigate()

  return (event) => {
    if (event.detail.external === true || typeof event.detail.href === 'undefined') {
      return
    }

    event.preventDefault()
    navigate(event.detail.href)
  }
}