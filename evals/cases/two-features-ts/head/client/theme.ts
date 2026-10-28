export type Theme = "light" | "dark"

const KEY = "theme"

export function loadTheme(): Theme {
  return localStorage.getItem(KEY) === "dark" ? "dark" : "light"
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(KEY, theme)
}
