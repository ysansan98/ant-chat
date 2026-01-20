const iconModules = import.meta.glob('../../assets/icons/provider/*.svg', { eager: true, query: '?react' })

const icons = Object.entries<any>(iconModules).reduce((acc, [path, module]) => {
  const iconNameMatch = path.match(/\/([^/]+)\.svg$/)
  if (iconNameMatch && iconNameMatch[1]) {
    const iconName = iconNameMatch[1]
    acc[iconName.toLowerCase()] = module.default
  }
  else {
    console.warn(`Could not extract icon name from path: ${path}`)
  }
  return acc
}, {} as Record<string, React.FC>)

export function getProviderLogo(name: string) {
  const lowerCaseName = name.toLowerCase()
  let Icon: React.FC | null = null
  if (lowerCaseName in icons) {
    Icon = icons[lowerCaseName]
  }
  return Icon
}
