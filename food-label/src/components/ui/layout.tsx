import React from "react";

function Layout({
  className = "",
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={`min-h-screen flex flex-col ${className}`} {...props}>
      {/* Header */}
      <header className="h-20 flex items-center justify-between px-6 sticky top-0 z-1000">
        <div className="flex items-center gap-3 w-full max-w-5xl mx-auto">
          {/* <span></span> */}
          <h1 className="text-2xl font-bold tracking-tight">Foomble</h1>
        </div>
      </header>

      {/* Main Content  */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-12 flex flex-col items-center justify-center">
        {children}
      </main>

      {/* Footer */}
      <footer className="h-24 flex items-center justify-center">
        <p>&copy; {new Date().getFullYear()} Foomble</p>
      </footer>
    </div>
  );
}

export { Layout };
