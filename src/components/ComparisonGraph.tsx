import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const ComparisonGraph = ({
  title = "Your Goal",
  subtitle,
  primaryLabel = "With App",
  comparisonLabel = "Traditional Method",
  startLabel = "Month 1",
  endLabel = "Month 6",
  statisticText = "80% maintain their results even 6 months later",
  primaryColor = "#6366F1", // Indigo
  comparisonColor = "#EF4444", // Red
  backgroundColor = "#F3F4F6",
}) => {
  const graphWidth = SCREEN_WIDTH - 80;
  const graphHeight = 200;
  const padding = 20;

  // Generate smooth curve paths using cubic bezier curves
  const generatePrimaryPath = () => {
    const startX = padding;
    const startY = padding + 20;
    const endX = graphWidth - padding;
    const endY = graphHeight - padding;

    // Smooth ascending curve (successful path)
    return `M ${startX} ${startY}
            C ${startX + 50} ${startY - 10},
              ${startX + 100} ${startY - 5},
              ${startX + 150} ${startY + 10}
            S ${endX - 100} ${endY - 60},
              ${endX} ${endY - 80}`;
  };

  const generateComparisonPath = () => {
    const startX = padding;
    const startY = padding + 20;
    const endX = graphWidth - padding;
    const endY = graphHeight - padding;

    // Curve that dips and stays lower (traditional path)
    return `M ${startX} ${startY}
            C ${startX + 50} ${startY + 40},
              ${startX + 100} ${startY + 60},
              ${startX + 150} ${startY + 50}
            S ${endX - 100} ${endY - 20},
              ${endX} ${endY - 30}`;
  };

  return (
    <View style={styles.container}>
      {title && <Text style={styles.title}>{title}</Text>}

      <View style={[styles.graphContainer, { backgroundColor }]}>
        <Svg width={graphWidth} height={graphHeight}>
          {/* Comparison path (red - traditional) */}
          <Path
            d={generateComparisonPath()}
            stroke={comparisonColor}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />

          {/* Primary path (blue - with app) */}
          <Path
            d={generatePrimaryPath()}
            stroke={primaryColor}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />

          {/* Starting points */}
          <Circle cx={padding} cy={padding + 20} r={6} fill={primaryColor} />
          <Circle cx={padding} cy={padding + 20} r={6} fill={comparisonColor} />

          {/* Ending points */}
          <Circle
            cx={graphWidth - padding}
            cy={graphHeight - padding - 80}
            r={6}
            fill={primaryColor}
          />
          <Circle
            cx={graphWidth - padding}
            cy={graphHeight - padding - 30}
            r={6}
            fill={comparisonColor}
          />
        </Svg>

        {/* Badge */}
        <View style={[styles.badge, { backgroundColor: primaryColor }]}>
          <Text style={styles.badgeText}>✓ {primaryLabel}</Text>
        </View>

        {/* Time labels */}
        <View style={styles.timeLabels}>
          <Text style={styles.timeLabel}>{startLabel}</Text>
          <Text style={styles.timeLabel}>{endLabel}</Text>
        </View>
      </View>

      {/* Legend */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 16, gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 20, height: 3, backgroundColor: primaryColor, borderRadius: 2 }} />
          <Text style={{ fontSize: 14, color: '#4B5563' }}>{primaryLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 20, height: 3, backgroundColor: comparisonColor, borderRadius: 2 }} />
          <Text style={{ fontSize: 14, color: '#4B5563' }}>{comparisonLabel}</Text>
        </View>
      </View>

      {/* Statistic */}
      {statisticText && (
        <View style={styles.statisticContainer}>
          <Text style={styles.statisticText}>{statisticText}</Text>
        </View>
      )}
    </View>
  );
};

const ComparisonGraphExamples = () => {
  return (
    <View style={styles.examplesContainer}>
      <ComparisonGraph
        title="Weight Loss Journey"
        primaryLabel="With CalAI"
        comparisonLabel="DIY"
        startLabel="Week 1"
        endLabel="Week 12"
        statisticText="80% maintain their results even 6 months later"
        primaryColor="#6366F1"
        comparisonColor="#EF4444"
      />
      <View style={styles.spacer} />

      <ComparisonGraph
        title="Your Growth"
        primaryLabel="With AI icons"
        comparisonLabel="Manual Design"
        startLabel="Beginning"
        endLabel="Your Result"
        statisticText="Users see 60% more clicks with AI-generated icons"
        primaryColor="#3b82f6"
        comparisonColor="#ef4444"
        backgroundColor="#ffffff"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  graphContainer: {
    borderRadius: 16,
    padding: 20,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    left: 30,
    bottom: 80,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  timeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  timeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  statisticContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  statisticText: {
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 22,
  },
  examplesContainer: {
    flex: 1,
    backgroundColor: 'white',
  },
  spacer: {
    height: 40,
  },
});

export default ComparisonGraph;
export { ComparisonGraphExamples };
