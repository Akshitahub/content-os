import { Suspense } from "react"
import { Loader2 } from "lucide-react"
import LoginForm from "./LoginForm"

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full max-w-md items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
