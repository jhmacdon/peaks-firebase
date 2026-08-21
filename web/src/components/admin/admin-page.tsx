import { PageHeader } from "../ui/page-header";

export function AdminPage({
  children,
  className = "",
  width = "wide",
}: {
  children: React.ReactNode;
  className?: string;
  width?: "wide" | "form";
}) {
  const maxWidth = width === "form" ? "max-w-[820px]" : "max-w-[1200px]";
  return (
    <main
      className={`mx-auto w-full ${maxWidth} px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12 ${className}`.trim()}
    >
      {children}
    </main>
  );
}

export function AdminPageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className = "",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between ${className}`.trim()}>
      <PageHeader
        title={title}
        breadcrumb={breadcrumb}
        meta={description ? <p className="max-w-[68ch]">{description}</p> : undefined}
      />
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminTableFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-media border border-border bg-surface ${className}`.trim()}
    >
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
