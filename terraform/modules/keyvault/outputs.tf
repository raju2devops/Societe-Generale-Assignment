output "id" {
  description = "Vault resource ID."
  value       = azurerm_key_vault.this.id
}

output "name" {
  description = "Vault name."
  value       = azurerm_key_vault.this.name
}

output "vault_uri" {
  description = "Data-plane URI, consumed by the ClusterSecretStore."
  value       = azurerm_key_vault.this.vault_uri
}

output "secret_names" {
  description = "Names of the secrets written to the vault."
  value = nonsensitive(sort(keys(var.secrets)))
}
