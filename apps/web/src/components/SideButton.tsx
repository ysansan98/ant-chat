interface SideButtonProps {
  icon: React.ReactNode
  children?: React.ReactNode
  onClick?: () => void
}

function SideButton({ icon, children, onClick }: SideButtonProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`
        flex w-full cursor-pointer items-center gap-4 rounded-md p-2
        hover:bg-gray-300
      `}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      <div className="flex shrink-0 items-center justify-center">
        {icon}
      </div>
      <div className="flex-1">
        {children}
      </div>
    </div>
  )
}

export default SideButton
