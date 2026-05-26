import { cva } from "class-variance-authority"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[background,border-color,box-shadow,color,filter] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-primary/45 bg-background/55 text-primary-foreground shadow-sm hover:border-transparent hover:bg-gradient focus-visible:border-transparent focus-visible:bg-gradient",
        secondary: "border border-border bg-secondary text-secondary-foreground hover:border-primary/50 hover:bg-secondary/90",
        ghost: "hover:bg-primary/15 hover:text-foreground",
        outline:
          "border border-input bg-background/35 hover:border-primary/50 hover:bg-primary/10 hover:text-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export { buttonVariants }
