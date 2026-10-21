"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  PolarComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

// Hanya modul yang dipakai yang didaftarkan agar ukuran bundel kecil.
echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  PolarComponent,
  TooltipComponent,
  DataZoomComponent,
  SVGRenderer,
]);

interface Props {
  option: EChartsCoreOption;
  height: number;
  ariaLabel: string;
  // square: tinggi = lebar, dibatasi `height`. Untuk grafik polar agar tidak ada ruang kosong di layar sempit.
  square?: boolean;
}

export default function EChart({ option, height, ariaLabel, square = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  const style = square
    ? { width: "100%", aspectRatio: "1 / 1", maxHeight: height }
    : { width: "100%", height };
  return <div ref={ref} role="img" aria-label={ariaLabel} style={style} />;
}
