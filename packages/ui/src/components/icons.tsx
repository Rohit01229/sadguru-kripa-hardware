import * as React from "react";

// Lightweight inline icon set (Lucide-style paths) so the component library needs
// no icon dependency. Each is a 24x24 stroke icon inheriting `currentColor`.
// Apps may use these or bring their own; screens import what they need.

export type IconProps = React.SVGAttributes<SVGSVGElement>;

function makeIcon(displayName: string, children: React.ReactNode) {
  const Icon = React.forwardRef<SVGSVGElement, IconProps>(
    ({ width, height, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={width ?? 16}
        height={height ?? 16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    ),
  );
  Icon.displayName = displayName;
  return Icon;
}

export const XIcon = makeIcon("XIcon", (
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>
));

export const CheckIcon = makeIcon("CheckIcon", <path d="M20 6 9 17l-5-5" />);

export const ChevronDownIcon = makeIcon("ChevronDownIcon", <path d="m6 9 6 6 6-6" />);

export const ChevronRightIcon = makeIcon("ChevronRightIcon", <path d="m9 18 6-6-6-6" />);

export const MenuIcon = makeIcon("MenuIcon", (
  <>
    <path d="M4 12h16" />
    <path d="M4 6h16" />
    <path d="M4 18h16" />
  </>
));

export const SearchIcon = makeIcon("SearchIcon", (
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>
));

export const AlertTriangleIcon = makeIcon("AlertTriangleIcon", (
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>
));

export const InfoIcon = makeIcon("InfoIcon", (
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </>
));

export const CheckCircleIcon = makeIcon("CheckCircleIcon", (
  <>
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <path d="m9 11 3 3L22 4" />
  </>
));
