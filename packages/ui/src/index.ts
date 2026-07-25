// @hardware/ui — shared design-system component library.
// Foundation owns this package; screen workers import and compose from here.

// Utilities
export { cn } from "./lib/cn";
export {
  formatMoney,
  formatPaisePlain,
  formatQty,
  formatDate,
  formatDateTime,
} from "./lib/format";

// Primitives
export { Button, buttonVariants, type ButtonProps } from "./components/button";
export { Input, type InputProps } from "./components/input";
export { Textarea, type TextareaProps } from "./components/textarea";
export { Label, type LabelProps } from "./components/label";
export { Select, type SelectProps } from "./components/select";
export {
  StateCodePicker,
  GST_STATE_CODES,
  type StateCodePickerProps,
} from "./components/state-code-picker";
export { Checkbox, type CheckboxProps } from "./components/checkbox";
export { FormField, type FormFieldProps } from "./components/form-field";

// Data display
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  type TableHeadProps,
  type TableCellProps,
} from "./components/table";
export {
  DataTable,
  type DataTableProps,
  type DataTableColumn,
} from "./components/data-table";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export { StatCard, type StatCardProps } from "./components/stat-card";
export {
  EmptyState,
  ForbiddenState,
  type EmptyStateProps,
  type ForbiddenStateProps,
} from "./components/empty-state";
export { Skeleton } from "./components/skeleton";
export { Spinner, type SpinnerProps } from "./components/spinner";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/card";
export { Alert, alertVariants, type AlertProps } from "./components/alert";

// Overlays & navigation
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  type DialogProps,
  type DialogContentProps,
} from "./components/dialog";
export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
  type SheetProps,
  type SheetContentProps,
} from "./components/sheet";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
} from "./components/dropdown-menu";
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsLink,
  type TabsProps,
  type TabsTriggerProps,
  type TabsContentProps,
  type TabsLinkProps,
} from "./components/tabs";
export { Toaster, toast, type ToastOptions } from "./components/toast";

// Layout chrome
export { PageHeader, type PageHeaderProps, type Breadcrumb } from "./components/page-header";
export { Container, type ContainerProps } from "./components/container";
export {
  AppShell,
  Sidebar,
  SidebarNav,
  SidebarNavGroup,
  SidebarNavItem,
  Topbar,
  type AppShellProps,
  type SidebarProps,
  type SidebarNavItemProps,
} from "./components/app-shell";

// Icons
export {
  XIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MenuIcon,
  SearchIcon,
  AlertTriangleIcon,
  InfoIcon,
  CheckCircleIcon,
  type IconProps,
} from "./components/icons";
