

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_key_vault" "this" {
  name                = "${var.name_prefix}kv${random_string.suffix.result}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  sku_name            = "standard"


  rbac_authorization_enabled = true

 
  purge_protection_enabled   = false
  soft_delete_retention_days = 7

  tags = var.tags
}


resource "azurerm_role_assignment" "writers" {
  for_each = var.writer_principal_ids

  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}

# Read-only, for External Secrets.
resource "azurerm_role_assignment" "readers" {
  for_each = var.reader_principal_ids

  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = each.value
}


resource "time_sleep" "wait_for_rbac" {
  depends_on      = [azurerm_role_assignment.writers]
  create_duration = "60s"
}

resource "azurerm_key_vault_secret" "this" {

  for_each = nonsensitive(toset(keys(var.secrets)))

  name         = each.key
  value        = var.secrets[each.key]
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [time_sleep.wait_for_rbac]
}
