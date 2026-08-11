output "id" {
  description = "Cluster resource ID."
  value       = azurerm_kubernetes_cluster.this.id
}

output "name" {
  description = "Cluster name."
  value       = azurerm_kubernetes_cluster.this.name
}

output "node_resource_group" {
  description = "The MC_* resource group AKS creates for node infrastructure."
  value       = azurerm_kubernetes_cluster.this.node_resource_group
}

output "oidc_issuer_url" {
  description = "OIDC issuer, used as the issuer of the federated identity credential."
  value       = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "kube_config" {
  description = "Admin-equivalent credentials, consumed by the helm provider."
  value       = azurerm_kubernetes_cluster.this.kube_config[0]
  sensitive   = true
}
