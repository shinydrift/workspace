import type { ReactElement } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';
import type { Activity as CalendarActivity } from 'react-activity-calendar';
import { Tooltip } from '../ui/tooltip';
import { formatCost, formatTokens } from '../../lib/analyticsFormatters';
import type { HeatmapActivity } from '../../lib/analyticsFormatters';

interface Props {
  data: HeatmapActivity[];
}

export function UsageHeatmap({ data }: Props) {
  if (data.length === 0) return null;

  return (
    <section className="border-t border-border/60 pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Activity</p>
      <div className="flex justify-center overflow-x-auto">
        <ActivityCalendar
          data={data}
          colorScheme="dark"
          theme={{
            dark: [
              'var(--border)',
              'color-mix(in oklch, var(--primary) 25%, transparent)',
              'color-mix(in oklch, var(--primary) 50%, transparent)',
              'color-mix(in oklch, var(--primary) 75%, transparent)',
              'var(--primary)',
            ],
          }}
          blockSize={10}
          blockMargin={3}
          blockRadius={2}
          fontSize={10}
          showWeekdayLabels
          showTotalCount={false}
          renderBlock={(block: ReactElement, activity: CalendarActivity) => {
            if (activity.count === 0) return block;
            const a = activity as HeatmapActivity;
            return (
              <Tooltip
                content={
                  <div className="flex flex-col gap-0.5">
                    <span>{a.date}</span>
                    <span>Cost: {formatCost(a.count)}</span>
                    <span>In: {formatTokens(a.inputTokens)}</span>
                    <span>Out: {formatTokens(a.outputTokens)}</span>
                    <span>Sessions: {a.sessionCount}</span>
                  </div>
                }
              >
                {block}
              </Tooltip>
            );
          }}
          labels={{ legend: { less: 'Less', more: 'More' } }}
        />
      </div>
    </section>
  );
}
