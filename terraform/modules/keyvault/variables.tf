variable "name_prefix" {
  description = "Prefix for the vault name; a random suffix is appended to keep it globally unique."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to create the vault in."
  type        = string
}

variable "tenant_id" {
  description = "Entra ID tenant that owns the vault."
  type        = string
}

variable "secrets" {
  description = "Secret name to value. Names may contain only alphanumerics and dashes."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "writer_principal_ids" {
  description = "Object IDs granted Key Vault Secrets Officer, keyed by a stable label."
  type        = map(string)
  default     = {}
}

variable "reader_principal_ids" {
  description = "Object IDs granted Key Vault Secrets User, keyed by a stable label."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags applied to the vault."
  type        = map(string)
  default     = {}
}
