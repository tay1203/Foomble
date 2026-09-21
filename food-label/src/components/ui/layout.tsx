import React from "react";
import { cn } from "@/lib/utils";

function Layout({
  className = "",
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("min-h-dvh flex flex-col overflow-hidden", className)} {...props}>
      <header className="relative z-10 px-5 py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl">
            <img src="/foomble_nobg.png" alt="" className="size-9 object-contain" />
          </span>
          <div>
            <h1 className="font-brand text-3xl font-normal">Foomble</h1>
            {/* <p className="text-xs text-muted-foreground">Know your label</p> */}
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-5 py-10">
        <div aria-hidden="true" className="absolute -left-20 top-12 size-56 rounded-full border-32 border-secondary" />
        <div aria-hidden="true" className="absolute -right-12 bottom-16 size-36 rounded-[2.5rem] bg-highlight-muted" />
        {children}
      </main>

      <footer className="relative flex h-20 items-center justify-center px-5 text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Foomble </p>
      </footer>
    </div>
  );
}

export { Layout };
