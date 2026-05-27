export function Logo() {
  return (
    <div className="relative flex items-center justify-center gap-2 select-none">
      <div className="size-7">
        <img src="./logo.svg" alt="logo" className="size-full" draggable={false} />
      </div>
      <div className="text-lg/8">
        Ant Chat
      </div>
    </div>
  )
}
