import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';

const TimeChart = () => {
  const width = Dimensions.get('window').width - 48;
  const height = 220;
  const paddingLeft = 20;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Data points for AI - showing upward trend (more content = more time saved)
  const dataPoints = [
    { x: 0.00, y: 0.10 },
    { x: 0.05, y: 0.15 },
    { x: 0.10, y: 0.22 },
    { x: 0.15, y: 0.30 },
    { x: 0.20, y: 0.38 },
    { x: 0.25, y: 0.46 },
    { x: 0.30, y: 0.54 },
    { x: 0.35, y: 0.61 },
    { x: 0.40, y: 0.67 },
    { x: 0.45, y: 0.72 },
    { x: 0.50, y: 0.76 },
    { x: 0.55, y: 0.80 },
    { x: 0.60, y: 0.83 },
    { x: 0.65, y: 0.86 },
    { x: 0.70, y: 0.88 },
    { x: 0.75, y: 0.90 },
    { x: 0.80, y: 0.92 },
    { x: 0.85, y: 0.94 },
    { x: 0.90, y: 0.96 },
    { x: 0.92, y: 0.97 },
    { x: 0.95, y: 0.98 },
    { x: 0.97, y: 0.99 },
    { x: 1.00, y: 1.00 },
  ];

  // Data points for manual method - slower upward trend
  const manualDataPoints = [
    { x: 0.00, y: 0.03 },
    { x: 0.05, y: 0.05 },
    { x: 0.10, y: 0.07 },
    { x: 0.15, y: 0.09 },
    { x: 0.20, y: 0.11 },
    { x: 0.25, y: 0.13 },
    { x: 0.30, y: 0.15 },
    { x: 0.35, y: 0.17 },
    { x: 0.40, y: 0.19 },
    { x: 0.43, y: 0.21 },
    { x: 0.47, y: 0.23 },
    { x: 0.50, y: 0.25 },
    { x: 0.53, y: 0.27 },
    { x: 0.57, y: 0.29 },
    { x: 0.60, y: 0.31 },
    { x: 0.65, y: 0.33 },
    { x: 0.70, y: 0.35 },
    { x: 0.75, y: 0.37 },
    { x: 0.80, y: 0.39 },
    { x: 0.85, y: 0.41 },
    { x: 0.90, y: 0.43 },
    { x: 0.95, y: 0.45 },
    { x: 1.00, y: 0.47 },
  ];

  // Convert data points to SVG coordinates
  const toSvgX = (x: number) => paddingLeft + x * chartWidth;
  const toSvgY = (y: number) => paddingTop + chartHeight - y * chartHeight;

  // Create straight line path
  const createSmoothPath = (points: typeof dataPoints) => {
    let path = `M ${toSvgX(points[0].x)} ${toSvgY(points[0].y)}`;
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      const nextX = toSvgX(point.x);
      const nextY = toSvgY(point.y);

      path += ` L ${nextX} ${nextY}`;
    }
    return path;
  };

  const linePath = createSmoothPath(dataPoints);
  const manualLinePath = createSmoothPath(manualDataPoints);

  // Create filled area paths
  const areaPath = `${linePath} L ${toSvgX(1)} ${toSvgY(0)} L ${toSvgX(0)} ${toSvgY(0)} Z`;
  const manualAreaPath = `${manualLinePath} L ${toSvgX(1)} ${toSvgY(0)} L ${toSvgX(0)} ${toSvgY(0)} Z`;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Time & Cost Saved</Text>

        <Svg width={width} height={height} style={styles.svg}>
          <Defs>
            <LinearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#3b82f6" stopOpacity="0.75" />
              <Stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
            </LinearGradient>
            <LinearGradient id="redGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#ef4444" stopOpacity="0.75" />
              <Stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
            </LinearGradient>
          </Defs>

          {/* Grid lines */}
          <Line
            x1={paddingLeft}
            y1={paddingTop + chartHeight * 0.25}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight * 0.25}
            stroke="#4b5563"
            strokeWidth="1"
            strokeDasharray="4,4"
          />
          <Line
            x1={paddingLeft}
            y1={paddingTop + chartHeight * 0.5}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight * 0.5}
            stroke="#4b5563"
            strokeWidth="1"
            strokeDasharray="4,4"
          />
          <Line
            x1={paddingLeft}
            y1={paddingTop + chartHeight * 0.75}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight * 0.75}
            stroke="#4b5563"
            strokeWidth="1"
            strokeDasharray="4,4"
          />

          {/* X-axis */}
          <Line
            x1={paddingLeft}
            y1={height - paddingBottom}
            x2={width - paddingRight}
            y2={height - paddingBottom}
            stroke="#6b7280"
            strokeWidth="2"
          />

          {/* Filled area under the red line (drawn first, so it's behind) */}
          <Path
            d={manualAreaPath}
            fill="url(#redGradient)"
          />

          {/* Filled area under the blue line */}
          <Path
            d={areaPath}
            fill="url(#gradient)"
          />

          {/* Red line for manual method */}
          <Path
            d={manualLinePath}
            stroke="#ef4444"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Blue line chart (AI) */}
          <Path
            d={linePath}
            stroke="#3b82f6"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* X-axis label */}
          <SvgText
            x={paddingLeft}
            y={height - 10}
            fontSize="11"
            fill="#ffffff"
            textAnchor="start"
          >
            Start
          </SvgText>
          <SvgText
            x={width - paddingRight}
            y={height - 10}
            fontSize="11"
            fill="#ffffff"
            textAnchor="end"
          >
            More Content
          </SvgText>
        </Svg>

        <View style={styles.legendContainer}>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
              <Text style={styles.legendItemText}>With AI Icon</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
              <Text style={styles.legendItemText}>Others</Text>
            </View>
          </View>
          <Text style={styles.legendText}>
            Edit Faster. Upload Sooner. Grow Quicker.
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 48,
  },
  card: {
    backgroundColor: '#1a1f26',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    opacity: 0.75,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 12,
    marginBottom: 0,
    textAlign: 'left',
  },
  svg: {
    marginBottom: 8,
    alignSelf: 'center',
  },
  legendContainer: {
    marginTop: 12,
    alignItems: 'center',
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendItemText: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '500',
  },
  legendText: {
    fontSize: 13,
    color: '#e5e7eb',
    textAlign: 'center',
  },
});

export default TimeChart;
