import { useState } from "react"

import { ExportButton } from "./ExportButton"
import { Orders } from "./Orders"
import { applyTheme, loadTheme, type Theme } from "./theme"

export function App() {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark"
    applyTheme(next)
    setTheme(next)
  }
  return (
    <main>
      <h1>Orders</h1>
      <button onClick={toggle}>
        {theme === "dark" ? "Light" : "Dark"} mode
      </button>
      <ExportButton />
      <Orders />
    </main>
  )
}
