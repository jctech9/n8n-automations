# Automações n8n

Workflows compatíveis com n8n `2.31.4` self-hosted em Docker.

## 01 — Monitor Ubuntu e Docker com alerta no Telegram

Arquivo para importar:

`workflows/01-monitor-ubuntu-docker-telegram.json`

O workflow:

- coleta CPU, memória, disco raiz, load average, uptime, kernel e IP;
- verifica acesso ao Docker, quantidade de contêineres e o estado do n8n;
- executa a verificação a cada 5 minutos;
- alerta quando um limite é ultrapassado;
- evita spam: repete o mesmo alerta somente após 60 minutos;
- avisa quando o servidor se recupera;
- envia um relatório diário às 08:00;
- sempre envia um relatório quando executado pelo gatilho manual.

Limites padrão:

| Métrica | Limite |
|---|---:|
| CPU | 85% |
| Memória | 85% |
| Disco `/` | 85% |
| Load por vCPU | 1,5 |

### 1. Permitir que o contêiner n8n alcance o Ubuntu host

No serviço `n8n` do seu `docker-compose.yml`, acrescente:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Há um exemplo em `docker-compose.host-access.example.yml`. Recrie o contêiner depois de alterar o Compose:

```bash
docker compose up -d
```

Se o n8n usa `network_mode: host`, esta entrada não é necessária e a credencial SSH pode usar `127.0.0.1`.

### 2. Criar um usuário de monitoramento no Ubuntu

O servidor precisa ter o OpenSSH Server ativo:

```bash
sudo apt update
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
```

Crie um usuário dedicado e permita a leitura do estado do Docker:

```bash
sudo adduser --disabled-password --gecos "" n8n-monitor
sudo usermod -aG docker n8n-monitor
```

> Atenção: pertencer ao grupo `docker` equivale, na prática, a ter privilégios elevados no host. Use este usuário somente para o monitoramento, autenticação por chave e não reutilize a chave.

Crie uma chave Ed25519 em uma máquina administrativa:

```bash
ssh-keygen -t ed25519 -f n8n_monitor_ed25519 -C "n8n-monitor"
ssh-copy-id -i n8n_monitor_ed25519.pub n8n-monitor@IP_DO_SERVIDOR
```

Não salve a chave privada neste repositório. O conteúdo da chave privada será cadastrado diretamente na credencial do n8n.

### 3. Criar o bot do Telegram

1. No Telegram, converse com `@BotFather`, use `/newbot` e copie o token.
2. Abra uma conversa com o novo bot e envie uma mensagem.
3. Descubra o Chat ID usando `@get_id_bot` ou a API `getUpdates` do Telegram.

### 4. Importar e configurar no n8n

1. No n8n, abra **Workflows → Import from File**.
2. Importe `workflows/01-monitor-ubuntu-docker-telegram.json`.
3. No node **Coletar status via SSH**, crie/selecione uma credencial **SSH Private Key**:
   - Host: `host.docker.internal`
   - Porta: `22`
   - Usuário: `n8n-monitor`
   - Private Key: conteúdo de `n8n_monitor_ed25519`
4. No node **Enviar para Telegram**, crie/selecione a credencial do Telegram com o token do bot.
5. No início do código do node **Avaliar e montar mensagem**, substitua:

```javascript
telegramChatId: 'SUBSTITUA_PELO_CHAT_ID',
```

6. Se desejar, ajuste os limites no mesmo bloco `CONFIG`.
7. Execute o node **Teste manual**. Depois que a mensagem chegar, salve e publique/ative o workflow.

### Observação importante sobre indisponibilidade total

Como o próprio n8n roda na máquina monitorada, ele não consegue enviar uma mensagem enquanto o Ubuntu estiver desligado, sem rede ou com o Docker totalmente parado. Após uma reinicialização, este workflow consegue detectar uptime baixo e avisar. Para detectar a queda completa em tempo real, é necessário um segundo monitor fora desse servidor (outro n8n, Uptime Kuma externo ou um serviço de uptime).

### Segurança

- O token do Telegram e a chave SSH ficam nas credenciais criptografadas do n8n, nunca no JSON do workflow.
- Restrinja a porta SSH no firewall aos endereços necessários.
- Mantenha autenticação SSH por senha desabilitada se ela não for necessária.
- O workflow começa desativado para que as credenciais e o Chat ID sejam configurados antes da publicação.

## 02 — Chatbot de lembretes pelo Telegram

Arquivo para importar:

`workflows/02-chatbot-lembretes-telegram.json`

O chatbot recebe mensagens em português, apresenta uma prévia com botões de confirmação e envia o lembrete no horário programado. Não utiliza API de IA: a interpretação é local, determinística e sem custo externo.

Exemplos reconhecidos:

```text
Me lembre amanhã às 09:30 de pagar a internet
Daqui a 20 minutos desligar o forno
Hoje às 18h ligar para João
Dia 05/08 às 14h renovar o documento
Segunda às 10h enviar a proposta
Todo dia às 08h tomar o remédio
Toda sexta às 17h enviar o relatório
```

Comandos disponíveis:

| Comando | Ação |
|---|---|
| `/start` ou `/ajuda` | Mostra instruções e exemplos |
| `/listar` | Lista os próximos lembretes |
| `/hoje` | Lista os lembretes do dia |
| `/cancelar 12` | Cancela o lembrete de número 12 |

Quando um lembrete é enviado, o Telegram apresenta botões para:

- marcar como concluído;
- adiar por 10 minutos;
- adiar por uma hora.

Lembretes recorrentes continuam com a próxima ocorrência ativa quando são concluídos. Se uma ocorrência recorrente for adiada, o chatbot cria um lembrete avulso para o adiamento sem alterar a agenda original.

### Configuração

1. Importe `workflows/02-chatbot-lembretes-telegram.json`.
2. Abra o node **Receber mensagem Telegram**.
3. Substitua `SUBSTITUA_PELO_CHAT_ID` pelo seu Chat ID.
   - Para permitir mais de um usuário, informe os IDs separados por vírgula.
   - Essa restrição impede que desconhecidos criem lembretes no bot.
4. Selecione a mesma credencial do bot em:
   - **Receber mensagem Telegram**
   - **Responder botao**
   - **Pedir confirmacao**
   - **Responder mensagem**
   - **Enviar lembrete**
5. Salve e publique/ative o workflow.
6. Envie `/ajuda` ao bot.

O n8n precisa estar acessível por HTTPS para que o Telegram consiga entregar eventos ao Telegram Trigger. O Telegram permite somente um Telegram Trigger ativo por bot; use um bot exclusivo para este chatbot se outro workflow já estiver recebendo mensagens com a mesma credencial.

### Armazenamento

Os lembretes ficam no estado persistente global do próprio workflow. Isso simplifica a instalação porque não exige PostgreSQL, planilha ou Data Table adicional.

Pontos importantes:

- os lembretes persistem entre execuções e reinicializações normais;
- execuções manuais de teste não devem ser usadas para validar persistência; teste enviando mensagens ao webhook publicado;
- exportar somente o JSON do workflow não inclui os lembretes armazenados;
- faça backup do banco de dados/volume do n8n para proteger os lembretes;
- lembretes concluídos ou cancelados são retidos por 90 dias;
- o limite padrão é de 500 lembretes ativos por chat.

### Fuso horário

O workflow utiliza `America/Sao_Paulo`. Para mudar, altere `CONFIG.timezone` nos nodes:

- **Processar mensagem e comandos**
- **Buscar lembretes vencidos**

Também altere `settings.timezone` do workflow.

### Desenvolvimento

Os códigos dos nodes ficam em:

- `workflow-sources/02-reminder-chatbot/process-message.js`
- `workflow-sources/02-reminder-chatbot/dispatch-due.js`

Depois de modificá-los, gere novamente o workflow:

```bash
node scripts/build-reminder-workflow.mjs
```

## Fontes

- Código-fonte do n8n: <https://github.com/n8n-io/n8n>
- Node Telegram: <https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.telegram/>
- Telegram Trigger: <https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/>
- Node SSH: <https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.ssh/>
