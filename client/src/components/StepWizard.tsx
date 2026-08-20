import { AuthShell } from "@/components/AuthShell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StepWizardProps {
  title: string;
  description: string;
  step: number;
  totalSteps: number;
  children: React.ReactNode;
}

export function StepWizard({ title, description, step, totalSteps, children }: StepWizardProps) {
  return (
    <AuthShell>
      <Card className="shadow-lift">
        <CardHeader className="gap-4 pb-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                Step {step + 1} of {totalSteps}
              </span>
              <span className="text-2xs font-medium tabular-nums text-muted-foreground/70">
                {Math.round(((step + 1) / totalSteps) * 100)}%
              </span>
            </div>
            <div className="flex gap-1.5" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={totalSteps}>
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-500 ease-spring",
                    i <= step ? "bg-primary shadow-glow-sm" : "bg-white/[0.07]"
                  )}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold leading-tight tracking-tight">{title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </AuthShell>
  );
}
