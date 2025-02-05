const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const dotenv = require('dotenv');
const https = require('https');

// Carregar variáveis de ambiente do arquivo .env
dotenv.config();

const app = express();
const port = 3000;

// Middleware para lidar com JSON no corpo da requisição
app.use(bodyParser.json());

// Criando um agente HTTPS que ignora o certificado SSL
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Função para buscar todos os itens com paginação
const getAllItems = async (sessionToken, AppToken, itemType) => {
    try {
        let allItems = [];
        let rangeStart = 0;
        let rangeEnd = 19;

        while (true) {
            const response = await axios.post(
                `${process.env.GLPI_URL}/search/${itemType}`,
                null,
                {
                    headers: {
                        'Authorization': `user_token ${process.env.USER_TOKEN}`,
                        'App-Token': AppToken,
                        'Session-Token': sessionToken
                    },
                    httpsAgent,
                    params: { range: `${rangeStart}-${rangeEnd}` }
                }
            );

            if (response.data && response.data.data) {
                allItems = [...allItems, ...response.data.data];
            }

            // Verifica se atingimos o total de itens disponíveis
            const totalCount = parseInt(response.data.totalcount || 0, 10);
            if (rangeEnd >= totalCount - 1) break;

            // Atualiza os intervalos para a próxima iteração
            rangeStart = rangeEnd + 1;
            rangeEnd = rangeStart + 19;
        }

        return allItems;
    } catch (error) {
        console.error('Erro ao buscar dados:', error.response ? error.response.data : error.message);
        throw new Error(error.response ? error.response.data : error.message);
    }
};

// Rota para iniciar sessão no GLPI
app.post('/initSession', async (req, res) => {
    const { Authorization, AppToken } = req.body;

    if (!Authorization || !AppToken) {
        return res.status(400).json({ message: 'Authorization e App-Token são necessários' });
    }

    try {
        const response = await axios.post(`${process.env.GLPI_URL}/initSession`, {}, {
            headers: {
                'Authorization': Authorization,
                'App-Token': AppToken
            },
            httpsAgent, // Usando o agente HTTPS para ignorar o certificado SSL
        });

        return res.status(200).json({
            message: 'Sessão iniciada com sucesso',
            sessionToken: response.data.session_token
        });
    } catch (error) {
        console.error('Erro ao iniciar sessão:', error.response ? error.response.data : error.message);
        return res.status(500).json({ message: 'Erro ao iniciar sessão', error: error.response ? error.response.data : error.message });
    }
});

// Rota para buscar todos os usuários
app.post('/users', async (req, res) => {
    const { sessionToken, AppToken } = req.body;

    if (!sessionToken || !AppToken) {
        return res.status(400).json({ message: 'Session-Token e App-Token são necessários' });
    }

    try {
        // Buscar todos os usuários
        const users = await getAllItems(sessionToken, AppToken, 'User');

        if (users.length === 0) {
            return res.status(404).json({ message: 'Nenhum usuário encontrado' });
        }

        // Formatando os dados dos usuários, incluindo o identificador "1" e ignorando aqueles com campos essenciais nulos ou vazios
        const formattedUsers = users
            .map(user => ({
                id: user['1'] || "",  // Identificador do usuário
                nome: user['9'] || "",  // Garantir que nome seja uma string (caso seja null ou undefined, substitui por "")
                sobrenome: user['34'] || "",  // Garantir que sobrenome seja uma string
                titulo: user['81'] || "",  // Garantir que título seja uma string
                email: user['5'] || "",  // Garantir que email seja uma string
                telefone: user['11'] || "",  // Garantir que telefone seja uma string
                setor: user['13'] || "",  // Garantir que setor seja uma string
                status: user['8'] || ""  // Garantir que status seja uma string
            }))
            .filter(user => user.nome && user.sobrenome && user.email); // Ignorar usuários sem nome, sobrenome ou email

        if (formattedUsers.length === 0) {
            return res.status(404).json({ message: 'Nenhum usuário válido encontrado' });
        }

        // Ordenar usuários pelo nome de forma crescente
        formattedUsers.sort((a, b) => {
            const nomeA = (a.nome || "").toLowerCase();  // Garantir que nomeA seja uma string
            const nomeB = (b.nome || "").toLowerCase();  // Garantir que nomeB seja uma string
            if (nomeA < nomeB) {
                return -1;
            }
            if (nomeA > nomeB) {
                return 1;
            }
            return 0;
        });

        // Retornar todos os usuários formatados e ordenados
        return res.status(200).json(formattedUsers);

    } catch (error) {
        console.error('Erro ao buscar dados dos usuários:', error.message);
        return res.status(500).json({ message: 'Erro ao buscar dados dos usuários', error: error.response ? error.response.data : error.message });
    }
});

app.post('/tickets', async (req, res) => {
    const { sessionToken, AppToken } = req.body;

    if (!sessionToken || !AppToken) {
        return res.status(400).json({ message: 'Session-Token e App-Token são necessários' });
    }

    try {
        // Buscar todos os tickets
        const tickets = await getAllItems(sessionToken, AppToken, 'Ticket');

        if (tickets.length === 0) {
            return res.status(404).json({ message: 'Nenhum ticket encontrado' });
        }

        // Função para converter o status numérico para o nome correspondente
        const converterStatus = (status) => {
            switch (status) {
                case 1:
                    return 'Novo';
                case 2:
                    return 'Em atendimento (atribuído)';
                case 3:
                    return 'Em atendimento (planejado)';
                case 4:
                    return 'Pendente';
                case 5:
                    return 'Solucionado';
                case 6:
                    return 'Fechado';
                default:
                    return 'Desconhecido';
            }
        };

        // Função para buscar informações do usuário (autor)
        const getUserName = async (userId) => {
            try {
                const response = await axios.get(`${process.env.GLPI_URL}/User/${userId}`, {
                    headers: {
                        'App-Token': AppToken,
                        'Session-Token': sessionToken
                    },
                    httpsAgent // Usando o agente HTTPS para ignorar o certificado SSL
                });

                const user = response.data;
                return `${user.firstname} ${user.realname}`; // Nome completo do autor
            } catch (error) {
                console.error('Erro ao buscar dados do autor:', error.message);
                return 'Desconhecido'; // Caso haja erro, retornamos 'Desconhecido'
            }
        };

        // Transformar cada ticket no modelo solicitado
        const ticketsFormatados = [];

        for (let ticket of tickets) {
            const autorNome = await getUserName(ticket['4']); // Buscar nome completo do autor
            ticketsFormatados.push({
                id: ticket.id, // ID do chamado
                titulo: ticket['1'], // Título do chamado
                status: converterStatus(ticket['12']), // Status convertido
                grupo_responsavel: ticket['8'], // Grupo responsável pelo chamado
                autor: autorNome, // Nome do autor
                data_criacao: ticket['19'] // Data de criação do chamado
            });
        }

        // Ordenar os tickets do mais recente para o mais antigo
        ticketsFormatados.sort((a, b) => {
            const dataA = new Date(a.data_criacao);
            const dataB = new Date(b.data_criacao);
            return dataB - dataA; // Ordem decrescente
        });

        // Retornar os tickets formatados
        return res.status(200).json(ticketsFormatados);

    } catch (error) {
        console.error('Erro ao buscar dados dos tickets:', error.message);
        return res.status(500).json({
            message: 'Erro ao buscar dados dos tickets',
            error: error.response ? error.response.data : error.message
        });
    }
});

// Iniciar o servidor na porta 3000
app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});