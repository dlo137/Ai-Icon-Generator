import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';

const StatisticsChart = () => {
  const width = Dimensions.get('window').width - 48;
  const height = 200;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Create smooth curve path for blue line (Ai Icon Generator)
  const bluePath = `
    M ${padding} ${padding + chartHeight * 0.5}
    Q ${padding + chartWidth * 0.25} ${padding + chartHeight * 0.55}
    ${padding + chartWidth * 0.5} ${padding + chartHeight * 0.6}
    T ${padding + chartWidth} ${padding + chartHeight * 0.1}
  `;

  // Create smooth curve path for red line (DIY Icons)
  const redPath = `
    M ${padding} ${padding + chartHeight * 0.5}
    Q ${padding + chartWidth * 0.25} ${padding + chartHeight * 0.8}
    ${padding + chartWidth * 0.5} ${padding + chartHeight * 0.75}
    T ${padding + chartWidth} ${padding + chartHeight * 0.6}
  `;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Your Performance</Text>
        <Svg width={width} height={height} style={styles.svg}>
          {/* Horizontal axis line */}
          <Line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke="#e5e7eb"
            strokeWidth="2"
          />

          {/* Red line (DIY) - drawn first so blue line is on top */}
          <Path
            d={redPath}
            stroke="#ef4444"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />

          {/* Blue line (AI) */}
          <Path
            d={bluePath}
            stroke="#3b82f6"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />

          {/* Beginning label */}
          <SvgText
            x={padding}
            y={height - 15}
            fontSize="12"
            fill="#6b7280"
            textAnchor="start"
          >
            Beginning
          </SvgText>

          {/* Your Result label */}
          <SvgText
            x={width - padding}
            y={height - 15}
            fontSize="12"
            fill="#6b7280"
            textAnchor="end"
          >
            Your Result
          </SvgText>
        </Svg>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#3b82f6' }]} />
            <Text style={styles.legendText}>With Ai Icon Generator</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.legendText}>DIY Icons</Text>
          </View>
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
    paddingVertical: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 12,
    textAlign: 'center',
  },
  svg: {
    marginBottom: 8,
  },
  legend: {
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 14,
    color: '#4b5563',
    fontWeight: '500',
  },
});

export default StatisticsChart;
