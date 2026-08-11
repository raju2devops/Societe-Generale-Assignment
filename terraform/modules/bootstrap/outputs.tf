output "cluster_secret_store_name" {
  description = "ClusterSecretStore the application's ExternalSecret binds to."
  value       = var.cluster_secret_store_name
}

output "ingress_class_name" {
  description = "IngressClass created by ingress-nginx."
  value       = "nginx"
}

output "monitoring_namespace" {
  description = "Namespace holding Prometheus, Grafana and Alertmanager. Empty when monitoring is disabled."
  value       = var.monitoring_enabled ? var.monitoring_namespace : ""
}
