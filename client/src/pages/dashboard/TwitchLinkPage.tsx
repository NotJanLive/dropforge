import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TwitchDeviceLink } from "@/components/TwitchDeviceLink";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

export function TwitchLinkPage() {
  const navigate = useNavigate();

  const onLinked = async () => {
    await api.minerReload().catch(() => undefined);
    navigate("/dashboard");
  };

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0">
        <PageHeader
          eyebrow="Twitch"
          title="Link Twitch"
          description="Connect your Twitch account so Dropforge can mine drops for you."
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:w-full"
              onClick={() => navigate("/dashboard/settings")}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to settings
            </Button>
          }
        />
      </div>

      <DashboardScrollArea className="pb-2">
        <Card className="max-w-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Twitch device login</CardTitle>
            <CardDescription className="text-xs">
              Same flow as initial setup — enter the code at twitch.tv/activate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TwitchDeviceLink onLinked={onLinked} />
          </CardContent>
        </Card>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
