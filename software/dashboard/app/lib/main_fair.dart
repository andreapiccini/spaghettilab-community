import 'package:dashboard_domain/dashboard_domain.dart';
import 'package:flutter/widgets.dart';

import 'app.dart';

/// Standalone presentation: existing dashboard UI and simulated data only.
/// No login, Backbone connection, MQTT broker or additional host service.
void main() {
  final host = FakeHost()..start();
  runApp(DashboardApp(host: host));
}
